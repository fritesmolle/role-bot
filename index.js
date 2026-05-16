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

const ROLE_ROOT = '1504204227189411972';

function hasRootOrAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.has(ROLE_ROOT);
}

function isClip(message) {
  // Fichiers joints (vidéos, images, gifs)
  if (message.attachments.size > 0) return true;
  // N'importe quelle URL
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return urlRegex.test(message.content);
}

function getClipDisplay(clip) {
  // Si c'est une pièce jointe, retourne l'URL directe
  if (clip.attachmentUrl) return clip.attachmentUrl;
  // Sinon retourne le contenu (URL externe)
  return clip.content || '';
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

const CLIPS_ROLE_CLIPEUR = '1504813562776916129';

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

  // Crée le salon clips-vote en lecture seule pour tout le monde
  const voteChannel = await guild.channels.create({
    name: '🎬︱clips-vote',
    type: 0,
    parent: CLIPS_CATEGORIE_ID,
    topic: '🎬 Votez pour votre clip préféré de la semaine ! Le gagnant sera annoncé à 22h.',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: ['SendMessages', 'AddReactions', 'CreatePublicThreads', 'CreatePrivateThreads'],
        allow: ['ViewChannel', 'ReadMessageHistory'],
      },
    ],
  });

  data.voteChannelId = voteChannel.id;
  data.votes = {};

  // Poste chaque clip avec un embed
  for (let i = 0; i < data.clips.length; i++) {
    const clip = data.clips[i];
    const clipEmbed = new EmbedBuilder()
      .setTitle(`🎬 Clip #${i + 1}`)
      .setDescription(`Posté par <@${clip.authorId}>`)
      .setColor(0x2B2D31)
      .setFooter({ text: `Clip ${i + 1} sur ${data.clips.length}` });

    // Si c'est une pièce jointe vidéo/image
    if (clip.attachmentUrl) {
      const isImage = clip.attachmentUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i);
      if (isImage) clipEmbed.setImage(clip.attachmentUrl);
      await voteChannel.send({ embeds: [clipEmbed] });
      if (!isImage) await voteChannel.send(clip.attachmentUrl); // poste la vidéo directement pour preview
    } else {
      // URL externe (YouTube, Twitch, etc.)
      clipEmbed.setDescription(`Posté par <@${clip.authorId}>\n\n${clip.content}`);
      await voteChannel.send({ embeds: [clipEmbed] });
    }
  }

  // Poste le message de vote avec les boutons
  const embed = new EmbedBuilder()
    .setTitle('🏆 Vote — Clip de la semaine !')
    .setDescription(`**${data.clips.length} clip(s)** en compétition cette semaine !\n\nClique sur le bouton correspondant au clip que tu préfères.\n\n⚠️ **Tu ne peux voter qu'une seule fois.**\n\n🕐 Le gagnant sera annoncé à **22h** ce soir !`)
    .setColor(0xF1C40F)
    .setTimestamp()
    .setFooter({ text: 'Bonne chance à tous les participants !' });

  const voteMsg = await voteChannel.send({
    content: `<@&${CLIPS_ROLE_CLIPEUR}> Le vote de la semaine est ouvert !`,
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

  // Annonce le gagnant avec un beau message
  const totalVotes = Object.keys(data.votes || {}).length;
  const gagnantEmbed = new EmbedBuilder()
    .setTitle('🏆 Clip de la semaine — Résultats !')
    .setDescription(
      `## 🥇 Félicitations à <@${meilleurClip.authorId}> !\n\n` +
      `Son clip remporte la semaine avec **${maxVotes} vote(s)** sur ${totalVotes} votant(s) !`
    )
    .addFields(
      { name: '🗳️ Votes reçus', value: `${maxVotes}`, inline: true },
      { name: '👥 Participants', value: `${totalVotes}`, inline: true },
      { name: '🎬 Clips en compétition', value: `${data.clips.length}`, inline: true },
    )
    .setColor(0xFFD700)
    .setTimestamp()
    .setFooter({ text: 'Bravo au gagnant ! Rendez-vous la semaine prochaine 🎬' });

  await voteChannel.send({
    content: `<@&${CLIPS_ROLE_CLIPEUR}> 🎉 Les résultats sont là !`,
    embeds: [gagnantEmbed],
  });

  // Poste le clip gagnant juste en dessous
  if (meilleurClip.attachmentUrl) {
    const isImage = meilleurClip.attachmentUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i);
    if (isImage) {
      const clipEmbed = new EmbedBuilder()
        .setDescription(`🏆 **Clip gagnant de <@${meilleurClip.authorId}>**`)
        .setImage(meilleurClip.attachmentUrl)
        .setColor(0xFFD700);
      await voteChannel.send({ embeds: [clipEmbed] });
    } else {
      await voteChannel.send(`🏆 **Clip gagnant de <@${meilleurClip.authorId}> :**\n${meilleurClip.attachmentUrl}`);
    }
  } else if (meilleurClip.content) {
    await voteChannel.send(`🏆 **Clip gagnant de <@${meilleurClip.authorId}> :**\n${meilleurClip.content}`);
  }

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
  if (!hasRootOrAdmin(interaction.member)) {
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
  if (!hasRootOrAdmin(interaction.member)) return;

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
  const estAdmin = hasRootOrAdmin(member);

  // --- Détection clips (pour tout le monde) ---
  if (message.channel.id === CLIPS_SOURCE_ID && isClip(message)) {
    const data = loadClips();
    const attachment = message.attachments.first();
    data.clips.push({
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content || '',
      attachmentUrl: attachment?.url || null,
      attachmentName: attachment?.name || null,
      messageId: message.id,
      voteMessageId: null,
    });
    saveClips(data);
    console.log(`🎬 Clip enregistré de ${message.author.tag}`);
  }

  if (!estAdmin) {
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

  // --- !clear <nombre> ---
  if (message.content.startsWith('!clear')) {
    const args = message.content.split(' ');
    const nombre = parseInt(args[1]);
    if (isNaN(nombre) || nombre < 1 || nombre > 100) return message.reply('❌ Indique un nombre entre 1 et 100 ! Ex: `!clear 10`');
    await message.delete().catch(() => {});
    const deleted = await message.channel.bulkDelete(nombre, true).catch(() => null);
    const confirm = await message.channel.send(`🗑️ **${deleted?.size || 0}** message(s) supprimé(s).`);
    setTimeout(() => confirm.delete().catch(() => {}), 4000);
  }

  // --- !kick @user raison ---
  if (message.content.startsWith('!kick')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!kick @user raison`');
    const raison = message.content.split(' ').slice(2).join(' ') || 'Aucune raison fournie';
    await user.kick(raison).catch(() => {});
    message.reply(`👢 **${user.user.tag}** a été kick. Raison : ${raison}`);
  }

  // --- !ban @user raison ---
  if (message.content.startsWith('!ban') && !message.content.startsWith('!unban')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!ban @user raison`');
    const raison = message.content.split(' ').slice(2).join(' ') || 'Aucune raison fournie';
    await user.ban({ reason: raison }).catch(() => {});
    message.reply(`🔨 **${user.user.tag}** a été banni. Raison : ${raison}`);
  }

  // --- !unban <userId> ---
  if (message.content.startsWith('!unban')) {
    const userId = message.content.split(' ')[1];
    if (!userId) return message.reply('❌ Indique un ID ! Ex: `!unban 123456789`');
    await message.guild.members.unban(userId).catch(() => {});
    message.reply(`✅ Utilisateur \`${userId}\` débanni.`);
  }

  // --- !mute @user <durée> (ex: 10m, 1h, 1j) ---
  if (message.content.startsWith('!mute') && !message.content.startsWith('!unmute')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!mute @user 10m`');
    const args = message.content.split(' ');
    const dureeStr = args[2] || '10m';
    let ms = 0;
    if (dureeStr.endsWith('m')) ms = parseInt(dureeStr) * 60 * 1000;
    else if (dureeStr.endsWith('h')) ms = parseInt(dureeStr) * 60 * 60 * 1000;
    else if (dureeStr.endsWith('j')) ms = parseInt(dureeStr) * 24 * 60 * 60 * 1000;
    else return message.reply('❌ Format invalide ! Utilise `10m`, `1h` ou `1j`');
    if (ms > 28 * 24 * 60 * 60 * 1000) return message.reply('❌ Maximum 28 jours !');
    await user.timeout(ms, 'Mute manuel').catch(() => {});
    message.reply(`🔇 **${user.user.tag}** muté pendant **${dureeStr}**.`);
  }

  // --- !unmute @user ---
  if (message.content.startsWith('!unmute')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!unmute @user`');
    await user.timeout(null).catch(() => {});
    message.reply(`🔊 **${user.user.tag}** est unmute.`);
  }

  // --- !slowmode <secondes> ---
  if (message.content.startsWith('!slowmode')) {
    const secondes = parseInt(message.content.split(' ')[1]);
    if (isNaN(secondes) || secondes < 0 || secondes > 21600) return message.reply('❌ Indique un nombre de secondes entre 0 et 21600 ! Ex: `!slowmode 5`');
    await message.channel.setRateLimitPerUser(secondes).catch(() => {});
    message.reply(secondes === 0 ? '✅ Slowmode désactivé.' : `⏱️ Slowmode activé : **${secondes}** seconde(s).`);
  }

  // --- !lock ---
  if (message.content === '!lock') {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    message.channel.send('🔒 Salon verrouillé.');
  }

  // --- !unlock ---
  if (message.content === '!unlock') {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    message.channel.send('🔓 Salon déverrouillé.');
  }

  // --- !help ---
  if (message.content === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Commandes disponibles')
      .setColor(0x5865F2)
      .addFields(
        { name: '🛡️ Modération', value: '`!warn @user raison` — Avertir\n`!warns @user` — Voir warns\n`!resetwarns @user` — Reset warns\n`!mute @user 10m/1h/1j` — Mute\n`!unmute @user` — Unmute\n`!kick @user raison` — Kick\n`!ban @user raison` — Ban\n`!unban <id>` — Unban' },
        { name: '🧹 Salons', value: '`!clear <1-100>` — Supprimer des messages\n`!slowmode <secondes>` — Slowmode\n`!lock` — Verrouiller le salon\n`!unlock` — Déverrouiller le salon' },
        { name: '🎭 Rôles', value: '`!setup-roles #salon "titre" 🎮=Role` — Créer un message de rôles' },
        { name: '🎬 Clips', value: '`!clips` — Voir les clips de la semaine\n`!testclips` — Lancer le vote manuellement\n`!testgagnant` — Annoncer le gagnant manuellement' },
        { name: '📊 Dashboard', value: '`!dashboard` — Ouvrir le dashboard de modération' },
      )
      .setFooter({ text: 'Toutes les commandes sont réservées au rôle Root' });
    message.reply({ embeds: [embed] });
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