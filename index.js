require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, EmbedBuilder,
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

// ==================== CONFIG ====================

const CONFIG_FILE = './config.json';
const WARNS_FILE = './warns.json';
const LOG_CHANNEL_ID = '1504787311383023626';

// ==================== CLIPS ====================
const CLIPS_SOURCE_ID = '1504795528972603433';
const CLIPS_CATEGORIE_ID = '1504201346344157326';
const CLIPS_ROLE_GAGNANT = '1504796213436747826';
const CLIPS_FILE = './clips.json';

function loadClips() {
  if (!fs.existsSync(CLIPS_FILE)) fs.writeFileSync(CLIPS_FILE, JSON.stringify({ clips: [], voteChannelId: null, votes: {} }, null, 2));
  const data = JSON.parse(fs.readFileSync(CLIPS_FILE, 'utf8'));
  if (!data.clips) data.clips = [];
  if (!data.votes) data.votes = {};
  return data;
}
function saveClips(data) {
  fs.writeFileSync(CLIPS_FILE, JSON.stringify(data, null, 2));
}

function isClip(message) {
  if (message.attachments.size > 0) return true;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = message.content.match(urlRegex);
  if (!urls) return false;
  return urls.some(url =>
    url.includes('youtube.com') || url.includes('youtu.be') ||
    url.includes('twitch.tv') || url.includes('clips.twitch') ||
    url.includes('streamable.com') || url.includes('medal.tv') ||
    url.includes('twitter.com') || url.includes('x.com') ||
    url.includes('tiktok.com')
  );
}

function buildVoteButtons(clips) {
  // Discord limite à 5 boutons par rangée et 5 rangées max (25 boutons)
  const rows = [];
  for (let i = 0; i < Math.min(clips.length, 25); i += 5) {
    const row = new ActionRowBuilder();
    for (let j = i; j < Math.min(i + 5, clips.length); j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`vote_clip_${j}`)
          .setLabel(`🎬 Clip #${j + 1}`)
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }
  return rows;
}

async function lancerVoteClips(guild) {
  const data = loadClips();
  if (data.clips.length === 0) {
    console.log('Aucun clip cette semaine, pas de vote.');
    return;
  }

  // Supprime l'ancien salon si existe
  if (data.voteChannelId) {
    const ancien = await guild.channels.fetch(data.voteChannelId).catch(() => null);
    if (ancien) await ancien.delete().catch(() => {});
  }

  // Crée le salon clips-vote
  const voteChannel = await guild.channels.create({
    name: 'clips-vote',
    type: 0,
    parent: CLIPS_CATEGORIE_ID,
    topic: '🎬 Votez pour votre clip préféré de la semaine ! Le gagnant sera annoncé à 22h.',
  });

  data.voteChannelId = voteChannel.id;
  data.votes = {};

  // Poste chaque clip
  for (let i = 0; i < data.clips.length; i++) {
    const clip = data.clips[i];
    await voteChannel.send(`**Clip #${i + 1}** — posté par <@${clip.authorId}>\n${clip.content}`);
  }

  // Poste le message de vote avec les boutons
  const embed = new EmbedBuilder()
    .setTitle('🎬 Vote — Clip de la semaine !')
    .setDescription(`**${data.clips.length} clip(s)** en compétition !\nClique sur le bouton du clip que tu préfères.\n\n⚠️ Tu ne peux voter qu'**une seule fois**.\nLe gagnant sera annoncé à **22h** ce soir !`)
    .setColor(0xF1C40F)
    .setTimestamp();

  const voteMsg = await voteChannel.send({
    embeds: [embed],
    components: buildVoteButtons(data.clips),
  });

  data.voteMessageId = voteMsg.id;
  saveClips(data);
  console.log(`✅ Salon clips-vote créé avec ${data.clips.length} clips.`);
}

async function annoncerGagnantClips(guild) {
  const data = loadClips();
  if (!data.voteChannelId || data.clips.length === 0) return;

  const voteChannel = await guild.channels.fetch(data.voteChannelId).catch(() => null);
  if (!voteChannel) return;

  // Compte les votes
  const comptage = {};
  for (const [, clipIndex] of Object.entries(data.votes || {})) {
    comptage[clipIndex] = (comptage[clipIndex] || 0) + 1;
  }

  let meilleurIndex = -1;
  let maxVotes = -1;
  for (const [index, nb] of Object.entries(comptage)) {
    if (nb > maxVotes) {
      maxVotes = nb;
      meilleurIndex = parseInt(index);
    }
  }

  if (meilleurIndex === -1) {
    await voteChannel.send('😔 Aucun vote cette semaine, pas de gagnant.');
    saveClips({ clips: [], voteChannelId: null, votes: {} });
    return;
  }

  const meilleurClip = data.clips[meilleurIndex];

  // Désactive les boutons
  if (data.voteMessageId) {
    const voteMsg = await voteChannel.messages.fetch(data.voteMessageId).catch(() => null);
    if (voteMsg) {
      const disabledRows = buildVoteButtons(data.clips).map(row => {
        row.components.forEach(btn => btn.setDisabled(true));
        return row;
      });
      await voteMsg.edit({ components: disabledRows }).catch(() => {});
    }
  }

  // Annonce le gagnant
  const gagnantEmbed = new EmbedBuilder()
    .setTitle('🏆 Clip de la semaine !')
    .setDescription(`Félicitations à <@${meilleurClip.authorId}> avec **${maxVotes} vote(s)** !\n\n${meilleurClip.content}`)
    .setColor(0xF1C40F)
    .setTimestamp();

  await voteChannel.send({ embeds: [gagnantEmbed] });

  // Donne le rôle au gagnant
  try {
    const member = await guild.members.fetch(meilleurClip.authorId);
    const role = guild.roles.cache.get(CLIPS_ROLE_GAGNANT);
    if (role) {
      for (const m of role.members.values()) {
        await m.roles.remove(CLIPS_ROLE_GAGNANT).catch(() => {});
      }
    }
    await member.roles.add(CLIPS_ROLE_GAGNANT);
    console.log(`🏆 Rôle Clip King donné à ${member.user.tag}`);
  } catch (err) {
    console.error('Erreur rôle gagnant:', err.message);
  }

  saveClips({ clips: [], voteChannelId: null, votes: {} });
}

function planifierClips(guild) {
  const maintenant = new Date();

  // Dimanche = 0
  const jourSemaine = maintenant.getDay();
  const heures = maintenant.getHours();
  const minutes = maintenant.getMinutes();

  // Calcule le prochain dimanche matin 10h
  const msDansUnJour = 24 * 60 * 60 * 1000;
  const joursAvantDimanche = (7 - jourSemaine) % 7 || 7;
  const prochainDimanche = new Date(maintenant);
  prochainDimanche.setDate(maintenant.getDate() + joursAvantDimanche);
  prochainDimanche.setHours(10, 0, 0, 0);

  // Calcule le prochain dimanche 22h
  const prochainDimanche22h = new Date(prochainDimanche);
  prochainDimanche22h.setHours(22, 0, 0, 0);

  const msAvantVote = prochainDimanche - maintenant;
  const msAvantAnnonce = prochainDimanche22h - maintenant;

  console.log(`⏰ Prochain vote clips dans ${Math.round(msAvantVote / 1000 / 60)} minutes`);
  console.log(`⏰ Prochaine annonce clips dans ${Math.round(msAvantAnnonce / 1000 / 60)} minutes`);

  setTimeout(async () => {
    await lancerVoteClips(guild);
    setInterval(() => lancerVoteClips(guild), 7 * msDansUnJour);
  }, msAvantVote);

  setTimeout(async () => {
    await annoncerGagnantClips(guild);
    setInterval(() => annoncerGagnantClips(guild), 7 * msDansUnJour);
  }, msAvantAnnonce);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function loadWarns() {
  if (!fs.existsSync(WARNS_FILE)) fs.writeFileSync(WARNS_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(WARNS_FILE, 'utf8'));
}
function saveWarns(warns) {
  fs.writeFileSync(WARNS_FILE, JSON.stringify(warns, null, 2));
}

// ==================== MOTS INTERDITS ====================

const MOTS_INTERDITS = [
  'connard', 'connasse', 'putain', 'merde', 'salope', 'enculé', 'enculer',
  'batard', 'bâtard', 'fdp', 'fils de pute', 'pd', 'pédé', 'nique',
  'niquer', 'ta gueule', 'ferme ta gueule', 'casse toi', 'va te faire',
  'ntm', 'nique ta mere', 'nique ta mère', 'tg', 'baltringue', 'bouffon',
  'abruti', 'crétin', 'imbécile', 'débile', 'attardé', 'mongol',
  'gros con', 'pauvre con', 'sale con', 'espèce de con', 'va te faire foutre',
  'je t emmerde', 'emmerdeur', 'emmerdeuse', 'va chier',
  'ferme la', 'ta mère', 'nique ta race', 'sale gosse', 'petit con',
  'gros nul', 'raté', 'minable', 'pitoyable',
  'ordure', 'déchet', 'pourriture', 'fumier', 'salopard',
  'couillon', 'andouille', 'branleur', 'branleuse', 'bite', 'couilles',
  'je vais te tuer', 'je vais te defoncer', 'je vais te niquer',
  'je vais te latter', 'je vais te peter la gueule', 'je vais te casser',
  'tu vas morfler', 'tu vas prendre', 'viens te battre',
  'je te retrouve', 'je sais ou tu habites', 'tu vas regretter',
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick',
  'pussy', 'motherfucker', 'stfu', 'kys', 'moron', 'dumbass',
  'shut up', 'go to hell', 'go die', 'kill yourself',
  'jackass', 'dipshit', 'douche', 'douchebag', 'scumbag', 'jerk',
  'prick', 'wanker', 'twat', 'tosser', 'dimwit', 'halfwit', 'nitwit',
  'i will kill you', 'i will hurt you', 'i know where you live',
  'you will regret', 'come fight me', 'i will find you',
];

function normaliser(texte) {
  return texte
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/[ç]/g, 'c').replace(/[ñ]/g, 'n')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's')
    .replace(/@/g, 'a').replace(/[^a-z\s]/g, '').replace(/(.)\1+/g, '$1');
}

// ==================== ANTI-SPAM ====================

const spamMap = new Map();
const SPAM_LIMITE = 5;
const SPAM_INTERVALLE = 3000;

// ==================== DASHBOARD ====================

function buildDashboardEmbed(guild) {
  const warns = loadWarns();
  const guildWarns = warns[guild.id] || {};

  const membres = Object.entries(guildWarns)
    .filter(([, nb]) => nb > 0)
    .sort(([, a], [, b]) => b - a);

  const barres = ['🟢', '🟡', '🟠', '🔴'];

  const description = membres.length === 0
    ? '*Aucun avertissement enregistré* ✅'
    : membres.map(([userId, nb]) => {
        const barre = barres[Math.min(nb - 1, 3)];
        return `${barre} <@${userId}> — **${nb}/4** avertissement(s)`;
      }).join('\n');

  return new EmbedBuilder()
    .setTitle('🛡️ Dashboard de Modération')
    .setDescription(description)
    .setColor(0x5865F2)
    .setFooter({ text: `${membres.length} membre(s) sanctionné(s) • Utilisez les boutons pour gérer` })
    .setTimestamp();
}

function buildDashboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dash_addwarn')
      .setLabel('➕ Ajouter warn')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('dash_removewarn')
      .setLabel('➖ Retirer warn')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dash_resetwarn')
      .setLabel('🔄 Reset warns')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('dash_refresh')
      .setLabel('🔁 Actualiser')
      .setStyle(ButtonStyle.Success),
  );
}

// ==================== SANCTIONS ====================

async function sanctionner(member, raison) {
  const warns = loadWarns();
  const userId = member.user.id;
  const guildId = member.guild.id;

  if (!warns[guildId]) warns[guildId] = {};
  if (!warns[guildId][userId]) warns[guildId][userId] = 0;

  warns[guildId][userId]++;
  const nbWarns = warns[guildId][userId];
  saveWarns(warns);

  const tag = member.user.tag;
  const sanctions = ['', '⚠️ Avertissement', '🔇 Mute 10 minutes', '🔇 Mute 24 heures', '🔨 Ban définitif'];
  const sanction = sanctions[Math.min(nbWarns, 4)];

  try {
    const logChannel = await member.guild.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('📋 Nouvel avertissement')
        .addFields(
          { name: 'Joueur', value: `${member.user} (${tag})`, inline: true },
          { name: 'Avertissement', value: `${nbWarns}/4`, inline: true },
          { name: 'Sanction', value: sanction, inline: true },
          { name: 'Raison', value: raison },
        )
        .setColor(nbWarns === 1 ? 0xFFA500 : nbWarns === 2 ? 0xFF6600 : nbWarns === 3 ? 0xFF3300 : 0xFF0000)
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }
  } catch (err) {
    console.error('Erreur log:', err.message);
  }

  try {
    if (nbWarns === 1) {
      await member.send(`⚠️ **Avertissement (1/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain : mute 10 minutes.`);
    } else if (nbWarns === 2) {
      await member.timeout(10 * 60 * 1000, raison);
      await member.send(`🔇 **Mute 10 minutes (2/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain : mute 24 heures.`);
    } else if (nbWarns === 3) {
      await member.timeout(24 * 60 * 60 * 1000, raison);
      await member.send(`🔇 **Mute 24 heures (3/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain : ban définitif.`);
    } else if (nbWarns >= 4) {
      await member.send(`🔨 **Ban définitif (4/4)** sur **${member.guild.name}**\nRaison : ${raison}`);
      await member.ban({ reason: raison });
    }
    console.log(`Sanction ${nbWarns}/4 appliquée à ${tag}`);
  } catch (err) {
    console.error(`Erreur sanction:`, err.message);
  }
}

// ==================== READY ====================

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (guild) planifierClips(guild);
});

// ==================== INTERACTIONS (boutons) ====================

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('vote_clip_')) {
    const clipIndex = parseInt(interaction.customId.replace('vote_clip_', ''));
    const data = loadClips();

    if (!data.votes) data.votes = {};

    if (data.votes[interaction.user.id] !== undefined) {
      return interaction.reply({ content: '❌ Tu as déjà voté !', ephemeral: true });
    }

    data.votes[interaction.user.id] = clipIndex;
    saveClips(data);

    const nbVotes = Object.values(data.votes).filter(v => v === clipIndex).length;
    return interaction.reply({ content: `✅ Tu as voté pour le **Clip #${clipIndex + 1}** ! (${nbVotes} vote(s) pour ce clip)`, ephemeral: true });
  }

  if (!interaction.isButton()) return;
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Tu n\'as pas la permission.', ephemeral: true });
  }

  const guild = interaction.guild;

  if (interaction.customId === 'dash_refresh') {
    await interaction.update({
      embeds: [buildDashboardEmbed(guild)],
      components: [buildDashboardButtons()],
    });
  }

  if (interaction.customId === 'dash_addwarn') {
    const members = await guild.members.fetch();
    const options = members
      .filter(m => !m.user.bot)
      .first(25)
      .map(m => ({ label: m.user.tag, value: m.user.id }));

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_addwarn')
        .setPlaceholder('Choisir un membre...')
        .addOptions(options)
    );
    await interaction.reply({ content: '➕ Quel membre ?', components: [menu], ephemeral: true });
  }

  if (interaction.customId === 'dash_removewarn') {
    const warns = loadWarns();
    const guildWarns = warns[guild.id] || {};
    const sanctionnes = Object.entries(guildWarns).filter(([, nb]) => nb > 0);

    if (sanctionnes.length === 0) {
      return interaction.reply({ content: '✅ Personne n\'a de warns !', ephemeral: true });
    }

    const options = await Promise.all(sanctionnes.slice(0, 25).map(async ([userId, nb]) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return { label: user ? `${user.tag} (${nb} warn(s))` : userId, value: userId };
    }));

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_removewarn')
        .setPlaceholder('Choisir un membre...')
        .addOptions(options)
    );
    await interaction.reply({ content: '➖ Quel membre ?', components: [menu], ephemeral: true });
  }

  if (interaction.customId === 'dash_resetwarn') {
    const warns = loadWarns();
    const guildWarns = warns[guild.id] || {};
    const sanctionnes = Object.entries(guildWarns).filter(([, nb]) => nb > 0);

    if (sanctionnes.length === 0) {
      return interaction.reply({ content: '✅ Personne n\'a de warns !', ephemeral: true });
    }

    const options = await Promise.all(sanctionnes.slice(0, 25).map(async ([userId, nb]) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return { label: user ? `${user.tag} (${nb} warn(s))` : userId, value: userId };
    }));

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_resetwarn')
        .setPlaceholder('Choisir un membre...')
        .addOptions(options)
    );
    await interaction.reply({ content: '🔄 Quel membre reset ?', components: [menu], ephemeral: true });
  }
});

// ==================== INTERACTIONS (menus) ====================

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

  const guild = interaction.guild;
  const userId = interaction.values[0];
  const warns = loadWarns();
  if (!warns[guild.id]) warns[guild.id] = {};
  if (!warns[guild.id][userId]) warns[guild.id][userId] = 0;

  if (interaction.customId === 'select_addwarn') {
    warns[guild.id][userId]++;
    saveWarns(warns);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await sanctionner(member, 'Warn manuel via dashboard');
    await interaction.update({ content: `✅ Warn ajouté à <@${userId}> (${warns[guild.id][userId]}/4)`, components: [] });
  }

  if (interaction.customId === 'select_removewarn') {
    if (warns[guild.id][userId] > 0) warns[guild.id][userId]--;
    saveWarns(warns);
    await interaction.update({ content: `✅ Warn retiré à <@${userId}> (${warns[guild.id][userId]}/4)`, components: [] });
  }

  if (interaction.customId === 'select_resetwarn') {
    warns[guild.id][userId] = 0;
    saveWarns(warns);
    await interaction.update({ content: `✅ Warns de <@${userId}> remis à zéro.`, components: [] });
  }
});

// ==================== MESSAGES ====================

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const member = message.member;
  const estAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

  if (!estAdmin) {
    // --- Détection clips ---
    if (message.channel.id === CLIPS_SOURCE_ID && isClip(message)) {
      const data = loadClips();
      data.clips.push({
        authorId: message.author.id,
        content: message.content || message.attachments.first()?.url || '',
        messageId: message.id,
        voteMessageId: null,
      });
      saveClips(data);
      console.log(`🎬 Clip enregistré de ${message.author.tag}`);
    }

    const contenuNormalise = normaliser(message.content);

    const motTrouve = MOTS_INTERDITS.find(mot => contenuNormalise.includes(normaliser(mot)));
    if (motTrouve) {
      await message.delete().catch(() => {});
      const avert = await message.channel.send(`⚠️ ${member}, ce mot n'est pas autorisé ici.`);
      setTimeout(() => avert.delete().catch(() => {}), 5000);
      await sanctionner(member, `Mot interdit : "${motTrouve}"`);
      return;
    }

    const userId = message.author.id;
    const maintenant = Date.now();
    if (!spamMap.has(userId)) {
      spamMap.set(userId, { count: 1, debut: maintenant });
    } else {
      const data = spamMap.get(userId);
      if (maintenant - data.debut < SPAM_INTERVALLE) {
        data.count++;
        if (data.count >= SPAM_LIMITE) {
          await message.delete().catch(() => {});
          const avert = await message.channel.send(`⚠️ ${member}, tu envoies des messages trop rapidement !`);
          setTimeout(() => avert.delete().catch(() => {}), 5000);
          spamMap.delete(userId);
          await sanctionner(member, 'Spam de messages');
          return;
        }
      } else {
        spamMap.set(userId, { count: 1, debut: maintenant });
      }
    }
  }

  if (!estAdmin) return;

  // --- !dashboard ---
  if (message.content === '!dashboard') {
    await message.delete().catch(() => {});
    await message.channel.send({
      embeds: [buildDashboardEmbed(message.guild)],
      components: [buildDashboardButtons()],
    });
  }

  // --- !testclips (force le lancement du vote pour tester) ---
  if (message.content === '!testclips') {
    await lancerVoteClips(message.guild);
    message.reply('✅ Vote clips lancé manuellement !');
  }

  // --- !testgagnant (force l'annonce du gagnant pour tester) ---
  if (message.content === '!testgagnant') {
    await annoncerGagnantClips(message.guild);
    message.reply('✅ Annonce gagnant lancée manuellement !');
  }

  // --- !clips (voir combien de clips enregistrés) ---
  if (message.content === '!clips') {
    const data = loadClips();
    message.reply(`🎬 **${data.clips.length}** clip(s) enregistré(s) cette semaine.`);
  }

  // --- !setup-roles ---
  if (message.content.startsWith('!setup-roles')) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('❌ Mentionne un canal !');

    const titreMatch = message.content.match(/"([^"]+)"/);
    if (!titreMatch) return message.reply('❌ Mets le titre entre guillemets !');
    const titre = titreMatch[1];

    const args = message.content.split(' ').slice(2).filter(a => !a.startsWith('"') && !a.includes(titre));
    const roles = {};
    const lignes = [];

    for (const arg of args) {
      if (arg.includes('=')) {
        const [emoji, roleName] = arg.split('=');
        const role = message.guild.roles.cache.find(r => r.name === roleName);
        if (!role) return message.reply(`❌ Le rôle \`${roleName}\` n'existe pas !`);
        roles[emoji] = role.id;
        lignes.push(`${emoji} → **${roleName}**`);
      }
    }

    if (Object.keys(roles).length === 0) return message.reply('❌ Aucun rôle trouvé !');

    const embed = new EmbedBuilder()
      .setTitle(titre)
      .setDescription(`Réagis avec un emoji pour obtenir ton rôle !\n\n${lignes.join('\n')}`)
      .setColor(0x5865F2)
      .setFooter({ text: 'Réagis pour obtenir un rôle • Retire ta réaction pour le perdre' });

    const roleMessage = await channel.send({ embeds: [embed] });
    for (const emoji of Object.keys(roles)) await roleMessage.react(emoji);

    const config = loadConfig();
    config[roleMessage.id] = { guildId: message.guild.id, channelId: channel.id, roles };
    saveConfig(config);

    message.reply(`✅ Message de rôles créé dans ${channel} !`);
  }

  // --- !warns @user ---
  if (message.content.startsWith('!warns')) {
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur !');
    const warns = loadWarns();
    const nb = warns[message.guild.id]?.[user.id] || 0;
    message.reply(`⚠️ **${user.tag}** a **${nb}/4** avertissement(s).`);
  }

  // --- !resetwarns @user ---
  if (message.content.startsWith('!resetwarns')) {
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur !');
    const warns = loadWarns();
    if (warns[message.guild.id]) warns[message.guild.id][user.id] = 0;
    saveWarns(warns);
    message.reply(`✅ Avertissements de **${user.tag}** remis à zéro.`);
  }

  // --- !warn @user raison ---
  if (message.content.startsWith('!warn')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur !');
    const raison = message.content.split(' ').slice(2).join(' ') || 'Aucune raison fournie';
    await sanctionner(user, raison);
    message.reply(`✅ **${user.user.tag}** a été sanctionné. Raison : ${raison}`);
  }
});

// ==================== REACTIONS ====================

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const config = loadConfig();
  const entry = config[reaction.message.id];
  if (!entry) return;

  const roleId = entry.roles[reaction.emoji.name];
  if (!roleId) return;

  const guild = await client.guilds.fetch(entry.guildId);
  const member = await guild.members.fetch(user.id);
  await member.roles.add(roleId);
  console.log(`✅ Rôle ajouté à ${user.tag}`);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

  const config = loadConfig();
  const entry = config[reaction.message.id];
  if (!entry) return;

  const roleId = entry.roles[reaction.emoji.name];
  if (!roleId) return;

  const guild = await client.guilds.fetch(entry.guildId);
  const member = await guild.members.fetch(user.id);
  await member.roles.remove(roleId);
  console.log(`❌ Rôle retiré à ${user.tag}`);
});

client.login(process.env.TOKEN);