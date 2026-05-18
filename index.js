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
    GatewayIntentBits.GuildVoiceStates,
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
  if (message.attachments.size > 0) return true;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return urlRegex.test(message.content);
}

function getClipDisplay(clip) {
  if (clip.attachmentUrl) return clip.attachmentUrl;
  return clip.content || '';
}

function buildVoteButtons(clips) {
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

  if (data.voteChannelId) {
    const ancien = await guild.channels.fetch(data.voteChannelId).catch(() => null);
    if (ancien) await ancien.delete().catch(() => {});
  }

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

  for (let i = 0; i < data.clips.length; i++) {
    const clip = data.clips[i];
    const clipEmbed = new EmbedBuilder()
      .setTitle(`🎬 Clip #${i + 1}`)
      .setDescription(`Posté par <@${clip.authorId}>`)
      .setColor(0x2B2D31)
      .setFooter({ text: `Clip ${i + 1} sur ${data.clips.length}` });

    if (clip.attachmentUrl) {
      const isImage = clip.attachmentUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i);
      if (isImage) clipEmbed.setImage(clip.attachmentUrl);
      await voteChannel.send({ embeds: [clipEmbed] });
      if (!isImage) await voteChannel.send(clip.attachmentUrl);
    } else {
      clipEmbed.setDescription(`Posté par <@${clip.authorId}>\n\n${clip.content}`);
      await voteChannel.send({ embeds: [clipEmbed] });
    }
  }

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
  const msDansUnJour = 24 * 60 * 60 * 1000;
  const jourSemaine = maintenant.getDay();
  const joursAvantDimanche = (7 - jourSemaine) % 7 || 7;
  const prochainDimanche = new Date(maintenant);
  prochainDimanche.setDate(maintenant.getDate() + joursAvantDimanche);
  prochainDimanche.setHours(10, 0, 0, 0);
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

// ==================== SMASHCOINS ÉCONOMIE ====================

const ECONOMY_FILE = './economy.json';

// Boutique : rôles créés automatiquement au démarrage
const SHOP_ITEMS = [
  {
    id: 'vip',
    label: '👑 VIP',
    description: 'Accès VIP — couleur dorée + icône exclusive',
    price: 500,
    roleId: null, // rempli au démarrage
    duration: 7 * 24 * 60 * 60 * 1000,
    color: 0xF1C40F,
    roleName: '👑 VIP',
    emoji: '👑',
    badge: '7 jours',
  },
  {
    id: 'top',
    label: '🏆 Top Player',
    description: 'Rôle Top Player — couleur violette premium',
    price: 800,
    roleId: null,
    duration: 7 * 24 * 60 * 60 * 1000,
    color: 0x9B59B6,
    roleName: '🏆 Top Player',
    emoji: '🏆',
    badge: '7 jours',
  },
  {
    id: 'og',
    label: '💎 OG',
    description: 'Rôle OG permanent — couleur cyan exclusive',
    price: 2000,
    roleId: null,
    duration: null,
    color: 0x1ABC9C,
    roleName: '💎 OG',
    emoji: '💎',
    badge: 'Permanent',
  },
];

// Crée les rôles boutique s'ils n'existent pas, et sauvegarde leurs IDs
async function initialiserRolesBoutique(guild) {
  for (const item of SHOP_ITEMS) {
    let role = guild.roles.cache.find(r => r.name === item.roleName);
    if (!role) {
      role = await guild.roles.create({
        name: item.roleName,
        color: item.color,
        reason: 'Création automatique rôle boutique SmashCoins',
        mentionable: false,
        hoist: true,
      });
      console.log(`✅ Rôle créé : ${item.roleName}`);
    } else {
      console.log(`✔️ Rôle existant : ${item.roleName} (${role.id})`);
    }
    item.roleId = role.id;
  }
}

function loadEconomy() {
  if (!fs.existsSync(ECONOMY_FILE)) fs.writeFileSync(ECONOMY_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(ECONOMY_FILE, 'utf8'));
}
function saveEconomy(data) {
  fs.writeFileSync(ECONOMY_FILE, JSON.stringify(data, null, 2));
}
function getBalance(userId) {
  const eco = loadEconomy();
  if (!eco[userId]) eco[userId] = { balance: 0, lastDaily: 0, lastMsg: 0, lastVoice: 0 };
  return eco[userId];
}
function addCoins(userId, amount) {
  const eco = loadEconomy();
  if (!eco[userId]) eco[userId] = { balance: 0, lastDaily: 0, lastMsg: 0, lastVoice: 0 };
  eco[userId].balance = (eco[userId].balance || 0) + amount;
  saveEconomy(eco);
  return eco[userId].balance;
}
function removeCoins(userId, amount) {
  const eco = loadEconomy();
  if (!eco[userId]) eco[userId] = { balance: 0, lastDaily: 0, lastMsg: 0, lastVoice: 0 };
  eco[userId].balance = Math.max(0, (eco[userId].balance || 0) - amount);
  saveEconomy(eco);
  return eco[userId].balance;
}
function formatCoins(n) {
  return `**${n.toLocaleString('fr-FR')} ⚡ SmashCoins**`;
}

// Gains passifs sur messages (cooldown 1 min)
const MSG_COOLDOWN = 60 * 1000;
const MSG_GAIN = 2;

// Gains passifs en vocal (toutes les 10 min)
const VOICE_INTERVAL = 10 * 60 * 1000;
const VOICE_GAIN = 5;
const voiceTimers = new Map();

// ==================== CASINO HELPERS ====================

const CASINO_BANNER = '`━━━━━━━━━━━━━━━━━━━━━━━━━━`';

function casinoEmbed(title, description, color = 0xF1C40F, footer = null) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${CASINO_BANNER}\n${description}\n${CASINO_BANNER}`)
    .setColor(color)
    .setFooter({ text: footer || '⚡ SmashCoins Casino  •  Joue responsablement' })
    .setTimestamp();
}

function gainsEmbed(userId, mise, gain, newBal, details, gagne) {
  const color = gagne ? 0x57F287 : 0xED4245;
  const header = gagne
    ? `## ✅  +${gain.toLocaleString('fr-FR')} ⚡`
    : `## ❌  -${mise.toLocaleString('fr-FR')} ⚡`;
  return new EmbedBuilder()
    .setDescription(`${CASINO_BANNER}\n${header}\n\n${details}\n\n> 💰 **Solde** : ${newBal.toLocaleString('fr-FR')} ⚡ SmashCoins\n${CASINO_BANNER}`)
    .setColor(color)
    .setFooter({ text: '⚡ SmashCoins Casino' })
    .setTimestamp();
}

// ==================== JACKPOT ====================

const JACKPOT_SYMBOLES = ['🍒', '🍋', '🍇', '⭐', '🎮', '💎', '🔥'];
const JACKPOT_MULTIPLICATEURS = {
  '💎💎💎': 50,
  '🔥🔥🔥': 20,
  '🎮🎮🎮': 15,
  '⭐⭐⭐': 10,
  '🍇🍇🍇': 5,
  '🍋🍋🍋': 3,
  '🍒🍒🍒': 2,
};

function jouerJackpot(mise) {
  const rouleaux = [0, 0, 0].map(() => JACKPOT_SYMBOLES[Math.floor(Math.random() * JACKPOT_SYMBOLES.length)]);
  const combo = rouleaux.join('');
  const multi = JACKPOT_MULTIPLICATEURS[combo] || 0;
  let gain = 0;
  let details = '';
  let gagne = false;

  const affichage = `\`[ ${rouleaux.join(' | ')} ]\``;

  if (multi > 0) {
    gain = mise * multi;
    gagne = true;
    details = `${affichage}\n\n🎰 **JACKPOT !** Multiplicateur **×${multi}**`;
  } else if (rouleaux[0] === rouleaux[1] || rouleaux[1] === rouleaux[2] || rouleaux[0] === rouleaux[2]) {
    gain = Math.floor(mise * 1.5);
    gagne = true;
    details = `${affichage}\n\n✨ **Deux identiques !** Petite victoire ×1.5`;
  } else {
    details = `${affichage}\n\n😔 Aucune combinaison gagnante.`;
  }

  return { rouleaux, gain, details, combo, gagne };
}

// ==================== ROULETTE ====================

function jouerRoulette(mise, choix) {
  const nombre = Math.floor(Math.random() * 37); // 0-36
  const rouge = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const estRouge = rouge.includes(nombre);
  const estNoir = nombre !== 0 && !estRouge;
  const estPair = nombre !== 0 && nombre % 2 === 0;
  const estImpair = nombre !== 0 && nombre % 2 !== 0;

  let gain = 0;
  let gagne = false;

  if (choix === 'rouge' && estRouge) { gain = mise; gagne = true; }
  else if (choix === 'noir' && estNoir) { gain = mise; gagne = true; }
  else if (choix === 'pair' && estPair) { gain = mise; gagne = true; }
  else if (choix === 'impair' && estImpair) { gain = mise; gagne = true; }
  else if (!isNaN(parseInt(choix)) && parseInt(choix) === nombre) { gain = mise * 35; gagne = true; }

  const couleur = nombre === 0 ? '🟩' : estRouge ? '🟥' : '⬛';
  return { nombre, couleur, gagne, gain };
}

// ==================== PILE OU FACE ====================

function jouerPileOuFace(mise, choix) {
  const resultat = Math.random() < 0.5 ? 'pile' : 'face';
  const gagne = resultat === choix;
  return { resultat, gagne, gain: gagne ? mise : 0 };
}

// ==================== DUEL ====================

const DUEL_FILE = './duels.json';
function loadDuels() {
  if (!fs.existsSync(DUEL_FILE)) fs.writeFileSync(DUEL_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(DUEL_FILE, 'utf8'));
}
function saveDuels(data) { fs.writeFileSync(DUEL_FILE, JSON.stringify(data, null, 2)); }

// ==================== VOCAL TRACKING ====================

function startVoiceTracking(userId, guildId) {
  if (voiceTimers.has(userId)) return;
  const interval = setInterval(async () => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const member = guild.members.cache.get(userId);
    if (!member || !member.voice.channel) {
      clearInterval(interval);
      voiceTimers.delete(userId);
      return;
    }
    addCoins(userId, VOICE_GAIN);
  }, VOICE_INTERVAL);
  voiceTimers.set(userId, interval);
}

function stopVoiceTracking(userId) {
  if (voiceTimers.has(userId)) {
    clearInterval(voiceTimers.get(userId));
    voiceTimers.delete(userId);
  }
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
  const membres = Object.entries(guildWarns).filter(([, nb]) => nb > 0).sort(([, a], [, b]) => b - a);
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
    new ButtonBuilder().setCustomId('dash_addwarn').setLabel('➕ Ajouter warn').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('dash_removewarn').setLabel('➖ Retirer warn').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_resetwarn').setLabel('🔄 Reset warns').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_refresh').setLabel('🔁 Actualiser').setStyle(ButtonStyle.Success),
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

  const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Avertissement')
    .addFields(
      { name: 'Membre', value: `${tag} (<@${userId}>)`, inline: true },
      { name: 'Avertissements', value: `${nbWarns}/4`, inline: true },
      { name: 'Raison', value: raison },
    )
    .setColor(nbWarns >= 4 ? 0xFF0000 : 0xFFA500)
    .setTimestamp();

  if (logChannel) await logChannel.send({ embeds: [embed] }).catch(() => {});

  if (nbWarns === 2) {
    await member.timeout(10 * 60 * 1000, 'Warn 2/4').catch(() => {});
  } else if (nbWarns === 3) {
    await member.timeout(60 * 60 * 1000, 'Warn 3/4').catch(() => {});
  } else if (nbWarns >= 4) {
    await member.ban({ reason: 'Warn 4/4 — ban automatique' }).catch(() => {});
  }
}

// ==================== READY ====================

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  if (guild) {
    planifierClips(guild);
    await initialiserRolesBoutique(guild);
    console.log('🛒 Rôles boutique initialisés.');
  }
});

// ==================== VOCAL STATE ====================

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const userId = newState.id || oldState.id;
  const guildId = newState.guild?.id || oldState.guild?.id;

  // Rejoint un vocal
  if (!oldState.channel && newState.channel) {
    startVoiceTracking(userId, guildId);
  }
  // Quitte un vocal
  if (oldState.channel && !newState.channel) {
    stopVoiceTracking(userId);
  }
});

// ==================== INTERACTIONS (boutons) ====================

client.on(Events.InteractionCreate, async (interaction) => {
  // ---- VOTE CLIPS ----
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

  // ---- CASINO : ROULETTE CHOIX ----
  if (interaction.isButton() && interaction.customId.startsWith('roulette_')) {
    const [, choix, userId, miseStr] = interaction.customId.split('_');
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ Ce n\'est pas ta roulette !', ephemeral: true });
    }
    const mise = parseInt(miseStr);
    const bal = getBalance(userId);
    if (bal.balance < mise) {
      return interaction.reply({ content: '❌ Tu n\'as plus assez de SmashCoins !', ephemeral: true });
    }

    const { nombre, couleur, gagne, gain } = jouerRoulette(mise, choix);
    let newBal;
    if (gagne) {
      newBal = addCoins(userId, gain);
    } else {
      newBal = removeCoins(userId, mise);
    }

    const embed = casinoEmbed(
      '🎡 Roulette',
      `La bille tombe sur : ${couleur} **${nombre}**\n\n` +
      (gagne
        ? `✅ **Gagné !** Tu remportes ${formatCoins(gain)} !`
        : `❌ **Perdu !** Tu perds ${formatCoins(mise)}.`) +
      `\n\n💰 Solde : ${formatCoins(newBal)}`,
      gagne ? 0x57F287 : 0xED4245
    );
    return interaction.update({ embeds: [embed], components: [] });
  }

  // ---- CASINO : PILE OU FACE CHOIX ----
  if (interaction.isButton() && interaction.customId.startsWith('pof_')) {
    const parts = interaction.customId.split('_');
    const choix = parts[1];
    const userId = parts[2];
    const mise = parseInt(parts[3]);

    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ Ce n\'est pas ton jeu !', ephemeral: true });
    }
    const bal = getBalance(userId);
    if (bal.balance < mise) {
      return interaction.reply({ content: '❌ Plus assez de SmashCoins !', ephemeral: true });
    }

    const { resultat, gagne, gain } = jouerPileOuFace(mise, choix);
    let newBal;
    if (gagne) {
      newBal = addCoins(userId, gain);
    } else {
      newBal = removeCoins(userId, mise);
    }

    const emoji = resultat === 'pile' ? '🪙' : '✨';
    const embed = casinoEmbed(
      '🪙 Pile ou Face',
      `${emoji} Résultat : **${resultat.toUpperCase()}**\n\n` +
      (gagne
        ? `✅ **Gagné !** Tu remportes ${formatCoins(gain)} !`
        : `❌ **Perdu !** Tu perds ${formatCoins(mise)}.`) +
      `\n\n💰 Solde : ${formatCoins(newBal)}`,
      gagne ? 0x57F287 : 0xED4245
    );
    return interaction.update({ embeds: [embed], components: [] });
  }

  // ---- DUEL : ACCEPTER/REFUSER ----
  if (interaction.isButton() && interaction.customId.startsWith('duel_accept_')) {
    const [, , challengerId, targetId, miseStr] = interaction.customId.split('_');
    if (interaction.user.id !== targetId) {
      return interaction.reply({ content: '❌ Ce duel ne te concerne pas !', ephemeral: true });
    }
    const mise = parseInt(miseStr);
    const balChallenger = getBalance(challengerId);
    const balTarget = getBalance(targetId);

    if (balChallenger.balance < mise || balTarget.balance < mise) {
      return interaction.update({ embeds: [casinoEmbed('⚔️ Duel', '❌ L\'un des joueurs n\'a plus assez de SmashCoins !', 0xED4245)], components: [] });
    }

    // Tirage au sort
    const challengerScore = Math.floor(Math.random() * 100);
    const targetScore = Math.floor(Math.random() * 100);
    const winnerId = challengerScore >= targetScore ? challengerId : targetId;
    const loserId = winnerId === challengerId ? targetId : challengerId;

    removeCoins(loserId, mise);
    addCoins(winnerId, mise);

    const winnerBal = getBalance(winnerId).balance;

    const embed = casinoEmbed(
      '⚔️ Duel — Résultats !',
      `<@${challengerId}> tire **${challengerScore}** ⚡\n` +
      `<@${targetId}> tire **${targetScore}** ⚡\n\n` +
      `🏆 **<@${winnerId}> gagne le duel !**\n` +
      `+${formatCoins(mise)} → Solde : ${formatCoins(winnerBal)}`,
      0x57F287
    );
    return interaction.update({ embeds: [embed], components: [] });
  }

  if (interaction.isButton() && interaction.customId.startsWith('duel_refuse_')) {
    const [, , challengerId, targetId] = interaction.customId.split('_');
    if (interaction.user.id !== targetId) {
      return interaction.reply({ content: '❌ Ce duel ne te concerne pas !', ephemeral: true });
    }
    const embed = casinoEmbed('⚔️ Duel', `❌ <@${targetId}> a refusé le duel.`, 0xED4245);
    return interaction.update({ embeds: [embed], components: [] });
  }

  // ---- BOUTIQUE : ACHETER ----
  if (interaction.isButton() && interaction.customId.startsWith('shop_buy_')) {
    const itemId = interaction.customId.replace('shop_buy_', '');
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return interaction.reply({ content: '❌ Article introuvable.', ephemeral: true });

    const bal = getBalance(interaction.user.id);
    if (bal.balance < item.price) {
      return interaction.reply({
        content: `❌ Tu n'as pas assez de SmashCoins ! Il te faut **${item.price} ⚡**, tu as **${bal.balance} ⚡**.`,
        ephemeral: true
      });
    }

    removeCoins(interaction.user.id, item.price);
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(item.roleId);

    if (role) {
      await member.roles.add(role).catch(() => {});
      if (item.duration) {
        setTimeout(async () => {
          await member.roles.remove(role).catch(() => {});
        }, item.duration);
      }
    }

    const newBal = getBalance(interaction.user.id).balance;
    return interaction.reply({
      embeds: [casinoEmbed(
        '🛒 Achat confirmé !',
        `✅ Tu as acheté **${item.label}** pour ${formatCoins(item.price)} !\n` +
        (item.duration ? `⏱️ Le rôle expirera dans **7 jours**.\n` : '♾️ Rôle permanent !\n') +
        `\n💰 Solde restant : ${formatCoins(newBal)}`,
        0x57F287
      )],
      ephemeral: true
    });
  }

  if (!interaction.isButton()) return;
  if (!hasRootOrAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Tu n\'as pas la permission.', ephemeral: true });
  }

  const guild = interaction.guild;

  if (interaction.customId === 'dash_refresh') {
    await interaction.update({ embeds: [buildDashboardEmbed(guild)], components: [buildDashboardButtons()] });
  }

  if (interaction.customId === 'dash_addwarn') {
    const members = await guild.members.fetch();
    const options = members.filter(m => !m.user.bot).first(25).map(m => ({ label: m.user.tag, value: m.user.id }));
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_addwarn').setPlaceholder('Choisir un membre...').addOptions(options)
    );
    await interaction.reply({ content: '➕ Quel membre ?', components: [menu], ephemeral: true });
  }

  if (interaction.customId === 'dash_removewarn') {
    const warns = loadWarns();
    const guildWarns = warns[guild.id] || {};
    const sanctionnes = Object.entries(guildWarns).filter(([, nb]) => nb > 0);
    if (sanctionnes.length === 0) return interaction.reply({ content: '✅ Personne n\'a de warns !', ephemeral: true });
    const options = await Promise.all(sanctionnes.slice(0, 25).map(async ([userId, nb]) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return { label: user ? `${user.tag} (${nb} warn(s))` : userId, value: userId };
    }));
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_removewarn').setPlaceholder('Choisir un membre...').addOptions(options)
    );
    await interaction.reply({ content: '➖ Quel membre ?', components: [menu], ephemeral: true });
  }

  if (interaction.customId === 'dash_resetwarn') {
    const warns = loadWarns();
    const guildWarns = warns[guild.id] || {};
    const sanctionnes = Object.entries(guildWarns).filter(([, nb]) => nb > 0);
    if (sanctionnes.length === 0) return interaction.reply({ content: '✅ Personne n\'a de warns !', ephemeral: true });
    const options = await Promise.all(sanctionnes.slice(0, 25).map(async ([userId, nb]) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return { label: user ? `${user.tag} (${nb} warn(s))` : userId, value: userId };
    }));
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('select_resetwarn').setPlaceholder('Choisir un membre...').addOptions(options)
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
  const userId = message.author.id;

  // --- Détection clips ---
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

  // --- Gains passifs sur messages ---
  const eco = loadEconomy();
  if (!eco[userId]) eco[userId] = { balance: 0, lastDaily: 0, lastMsg: 0, lastVoice: 0 };
  const now = Date.now();
  if (now - (eco[userId].lastMsg || 0) > MSG_COOLDOWN) {
    eco[userId].lastMsg = now;
    saveEconomy(eco);
    addCoins(userId, MSG_GAIN);
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

  // ==================== COMMANDES ÉCONOMIE (tout le monde) ====================

  // --- !solde (@user optionnel) ---
  if (message.content.startsWith('!solde')) {
    const target = message.mentions.users.first() || message.author;
    const bal = getBalance(target.id);
    const embed = new EmbedBuilder()
      .setTitle('⚡ SmashCoins')
      .setDescription(`${target.id === message.author.id ? 'Ton solde' : `Solde de **${target.username}**`} : ${formatCoins(bal.balance)}`)
      .setColor(0xF1C40F)
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // --- !daily ---
  if (message.content === '!daily') {
    const eco = loadEconomy();
    if (!eco[userId]) eco[userId] = { balance: 0, lastDaily: 0, lastMsg: 0 };
    const lastDaily = eco[userId].lastDaily || 0;
    const cooldown = 24 * 60 * 60 * 1000;
    const restant = cooldown - (Date.now() - lastDaily);

    if (restant > 0) {
      const heures = Math.floor(restant / (60 * 60 * 1000));
      const minutes = Math.floor((restant % (60 * 60 * 1000)) / (60 * 1000));
      return message.reply(`⏳ Daily déjà récupéré ! Reviens dans **${heures}h ${minutes}min**.`);
    }

    const gain = Math.floor(Math.random() * 51) + 50; // 50-100 SC
    eco[userId].lastDaily = Date.now();
    saveEconomy(eco);
    addCoins(userId, gain);
    const newBal = getBalance(userId).balance;

    const embed = new EmbedBuilder()
      .setTitle('🎁 Bonus Quotidien')
      .setDescription(`${CASINO_BANNER}\n## ✅  +${gain} ⚡\n\nTon bonus du jour est arrivé !\n\n> 💰 **Solde** : ${newBal.toLocaleString('fr-FR')} ⚡ SmashCoins\n${CASINO_BANNER}`)
      .setColor(0xF1C40F)
      .setFooter({ text: '⚡ SmashCoins  •  Reviens demain pour un nouveau bonus !' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // --- !top ---
  if (message.content === '!top') {
    const eco = loadEconomy();
    const sorted = Object.entries(eco)
      .sort(([, a], [, b]) => (b.balance || 0) - (a.balance || 0))
      .slice(0, 10);

    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(sorted.map(async ([uid, data], i) => {
      const user = await client.users.fetch(uid).catch(() => null);
      const name = user ? user.username : `Inconnu`;
      const medal = medals[i] || `\`#${i + 1}\``;
      return `${medal}  **${name}** — \`${(data.balance || 0).toLocaleString('fr-FR')} ⚡\``;
    }));

    const embed = new EmbedBuilder()
      .setTitle('🏆 Classement SmashCoins')
      .setDescription(`${CASINO_BANNER}\n${lines.join('\n') || 'Aucun joueur.'}\n${CASINO_BANNER}`)
      .setColor(0xF1C40F)
      .setFooter({ text: '⚡ SmashCoins Casino' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // --- !transfert @user <montant> ---
  if (message.content.startsWith('!transfert')) {
    const target = message.mentions.users.first();
    const args = message.content.split(' ');
    const montant = parseInt(args[args.length - 1]);

    if (!target || isNaN(montant) || montant <= 0) {
      return message.reply('❌ Usage : `!transfert @user <montant>`');
    }
    if (target.id === userId) return message.reply('❌ Tu ne peux pas te transférer des SmashCoins à toi-même !');

    const bal = getBalance(userId);
    if (bal.balance < montant) return message.reply(`❌ Tu n'as que \`${bal.balance.toLocaleString('fr-FR')} ⚡\` !`);

    removeCoins(userId, montant);
    addCoins(target.id, montant);

    const embed = new EmbedBuilder()
      .setTitle('💸 Transfert effectué')
      .setDescription(`${CASINO_BANNER}\n✅ Tu as envoyé \`${montant.toLocaleString('fr-FR')} ⚡\` à <@${target.id}> !\n\n> 💰 **Ton solde** : \`${getBalance(userId).balance.toLocaleString('fr-FR')} ⚡\`\n${CASINO_BANNER}`)
      .setColor(0x57F287)
      .setFooter({ text: '⚡ SmashCoins' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ==================== CASINO ====================

  // --- !jackpot <mise> ---
  if (message.content.startsWith('!jackpot')) {
    const args = message.content.split(' ');
    const mise = parseInt(args[1]);
    if (isNaN(mise) || mise < 10) return message.reply('❌ Mise minimum : **10 ⚡**. Ex: `!jackpot 50`');

    const bal = getBalance(userId);
    if (bal.balance < mise) return message.reply(`❌ Tu n'as que \`${bal.balance.toLocaleString('fr-FR')} ⚡\` !`);

    removeCoins(userId, mise);
    const { gain, details, gagne } = jouerJackpot(mise);
    if (gain > 0) addCoins(userId, gain);
    const newBal = getBalance(userId).balance;

    const embed = new EmbedBuilder()
      .setTitle('🎰 Machine à Sous')
      .setDescription(`${CASINO_BANNER}\nMise : \`${mise.toLocaleString('fr-FR')} ⚡\`\n\n${details}\n\n> 💰 **Solde** : \`${newBal.toLocaleString('fr-FR')} ⚡\`\n${CASINO_BANNER}`)
      .setColor(gagne ? 0x57F287 : 0xED4245)
      .setFooter({ text: '⚡ SmashCoins Casino  •  Jackpot max ×50' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // --- !roulette <mise> ---
  if (message.content.startsWith('!roulette')) {
    const args = message.content.split(' ');
    const mise = parseInt(args[1]);
    if (isNaN(mise) || mise < 10) return message.reply('❌ Mise minimum : **10 ⚡**. Ex: `!roulette 50`');

    const bal = getBalance(userId);
    if (bal.balance < mise) return message.reply(`❌ Tu n'as que \`${bal.balance.toLocaleString('fr-FR')} ⚡\` !`);

    const embed = new EmbedBuilder()
      .setTitle('🎡 Roulette')
      .setDescription(`${CASINO_BANNER}\nMise : \`${mise.toLocaleString('fr-FR')} ⚡\`\n\nChoisis ton pari :\n🟥 **Rouge** ou ⬛ **Noir** → ×2\n🔢 **Pair** ou 🔣 **Impair** → ×2\n🎯 **Numéro exact (0-36)** → ×35\n${CASINO_BANNER}`)
      .setColor(0xE74C3C)
      .setFooter({ text: '⚡ SmashCoins Casino  •  0 est ni rouge ni noir' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`roulette_rouge_${userId}_${mise}`).setLabel('🟥 Rouge ×2').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`roulette_noir_${userId}_${mise}`).setLabel('⬛ Noir ×2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`roulette_pair_${userId}_${mise}`).setLabel('🔢 Pair ×2').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`roulette_impair_${userId}_${mise}`).setLabel('🔣 Impair ×2').setStyle(ButtonStyle.Primary),
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // --- !pileouface <mise> ---
  if (message.content.startsWith('!pileouface')) {
    const args = message.content.split(' ');
    const mise = parseInt(args[1]);
    if (isNaN(mise) || mise < 10) return message.reply('❌ Mise minimum : **10 ⚡**. Ex: `!pileouface 50`');

    const bal = getBalance(userId);
    if (bal.balance < mise) return message.reply(`❌ Tu n'as que \`${bal.balance.toLocaleString('fr-FR')} ⚡\` !`);

    const embed = new EmbedBuilder()
      .setTitle('🪙 Pile ou Face')
      .setDescription(`${CASINO_BANNER}\nMise : \`${mise.toLocaleString('fr-FR')} ⚡\`\n\n50% de chances de **doubler ta mise** !\nChoisis ton côté :\n${CASINO_BANNER}`)
      .setColor(0xF39C12)
      .setFooter({ text: '⚡ SmashCoins Casino' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pof_pile_${userId}_${mise}`).setLabel('🪙 Pile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pof_face_${userId}_${mise}`).setLabel('✨ Face').setStyle(ButtonStyle.Secondary),
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // --- !duel @user <mise> ---
  if (message.content.startsWith('!duel')) {
    const target = message.mentions.users.first();
    const args = message.content.split(' ');
    const mise = parseInt(args[args.length - 1]);

    if (!target || isNaN(mise) || mise < 10) {
      return message.reply('❌ Usage : `!duel @user <mise>`. Mise minimum : 10 ⚡');
    }
    if (target.id === userId) return message.reply('❌ Tu ne peux pas te défier toi-même !');
    if (target.bot) return message.reply('❌ Tu ne peux pas défier un bot !');

    const balChallenger = getBalance(userId);
    const balTarget = getBalance(target.id);

    if (balChallenger.balance < mise) return message.reply(`❌ Tu n'as que \`${balChallenger.balance.toLocaleString('fr-FR')} ⚡\` !`);
    if (balTarget.balance < mise) return message.reply(`❌ <@${target.id}> n'a que \`${balTarget.balance.toLocaleString('fr-FR')} ⚡\` !`);

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Duel SmashCoins')
      .setDescription(`${CASINO_BANNER}\n<@${userId}> défie <@${target.id}> !\n\n💰 Mise : \`${mise.toLocaleString('fr-FR')} ⚡\`\n🎯 Le gagnant remporte **le double** !\n\n<@${target.id}>, tu acceptes ?\n${CASINO_BANNER}`)
      .setColor(0xF1C40F)
      .setFooter({ text: '⚡ SmashCoins Casino  •  Tirage aléatoire' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`duel_accept_${userId}_${target.id}_${mise}`).setLabel('⚔️ Accepter').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`duel_refuse_${userId}_${target.id}_${mise}`).setLabel('🏳️ Refuser').setStyle(ButtonStyle.Danger),
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // --- !casino ---
  if (message.content === '!casino') {
    const bal = getBalance(userId);
    const embed = new EmbedBuilder()
      .setTitle('🎰 SmashCoins Casino')
      .setDescription(`${CASINO_BANNER}\nBienvenue, <@${userId}> !\n💰 Solde : \`${bal.balance.toLocaleString('fr-FR')} ⚡\`\n${CASINO_BANNER}`)
      .addFields(
        { name: '🎰 Machine à sous', value: '`!jackpot <mise>`\nMultiplicateurs jusqu\'à **×50** 💎', inline: true },
        { name: '🎡 Roulette', value: '`!roulette <mise>`\nRouge/Noir/Pair/Impair ou numéro **×35**', inline: true },
        { name: '🪙 Pile ou Face', value: '`!pileouface <mise>`\n50/50 — double ou rien', inline: true },
        { name: '⚔️ Duel', value: '`!duel @user <mise>`\nAffronte un membre, le gagnant prend tout', inline: true },
        { name: '📊 Économie', value: '`!solde` `!daily` `!top` `!transfert`', inline: true },
        { name: '🛒 Boutique', value: '`!shop` — Achète des rôles avec tes coins', inline: true },
      )
      .setColor(0xF1C40F)
      .setFooter({ text: '⚡ SmashCoins Casino  •  Mise minimum : 10 ⚡' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ==================== BOUTIQUE ====================

  // --- !shop ---
  if (message.content === '!shop') {
    const bal = getBalance(userId);

    const embed = new EmbedBuilder()
      .setTitle('🛒 Boutique SmashCoins')
      .setDescription(`${CASINO_BANNER}\n💰 Ton solde : \`${bal.balance.toLocaleString('fr-FR')} ⚡ SmashCoins\`\n\nClique sur un article pour l'acheter !\n${CASINO_BANNER}`)
      .setColor(0x5865F2)
      .setFooter({ text: '⚡ SmashCoins  •  Les rôles temporaires expirent automatiquement' })
      .setTimestamp();

    SHOP_ITEMS.forEach(item => {
      const canAfford = bal.balance >= item.price;
      embed.addFields({
        name: `${item.emoji} ${item.label}`,
        value: `${item.description}\n💰 Prix : \`${item.price.toLocaleString('fr-FR')} ⚡\`  •  ⏱️ ${item.badge}  ${canAfford ? '✅' : '❌'}`,
        inline: true,
      });
    });

    const row = new ActionRowBuilder().addComponents(
      ...SHOP_ITEMS.map(item =>
        new ButtonBuilder()
          .setCustomId(`shop_buy_${item.id}`)
          .setLabel(`${item.emoji} ${item.label.replace(/[👑🏆💎]/g, '').trim()} — ${item.price} ⚡`)
          .setStyle(ButtonStyle.Primary)
      )
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // ==================== COMMANDES ADMIN ====================

  if (!estAdmin) return;

  // --- !addcoins @user <montant> ---
  if (message.content.startsWith('!addcoins')) {
    const target = message.mentions.users.first();
    const montant = parseInt(message.content.split(' ').pop());
    if (!target || isNaN(montant)) return message.reply('❌ Usage : `!addcoins @user <montant>`');
    const newBal = addCoins(target.id, montant);
    message.reply(`✅ +${formatCoins(montant)} ajoutés à <@${target.id}>. Nouveau solde : ${formatCoins(newBal)}`);
  }

  // --- !removecoins @user <montant> ---
  if (message.content.startsWith('!removecoins')) {
    const target = message.mentions.users.first();
    const montant = parseInt(message.content.split(' ').pop());
    if (!target || isNaN(montant)) return message.reply('❌ Usage : `!removecoins @user <montant>`');
    const newBal = removeCoins(target.id, montant);
    message.reply(`✅ -${formatCoins(montant)} retirés à <@${target.id}>. Nouveau solde : ${formatCoins(newBal)}`);
  }

  // --- !dashboard ---
  if (message.content === '!dashboard') {
    await message.delete().catch(() => {});
    await message.channel.send({ embeds: [buildDashboardEmbed(message.guild)], components: [buildDashboardButtons()] });
  }

  // --- !testclips ---
  if (message.content === '!testclips') {
    await lancerVoteClips(message.guild);
    message.reply('✅ Vote clips lancé manuellement !');
  }

  // --- !testgagnant ---
  if (message.content === '!testgagnant') {
    await annoncerGagnantClips(message.guild);
    message.reply('✅ Annonce gagnant lancée manuellement !');
  }

  // --- !clips ---
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

  // --- !mute @user <durée> ---
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
        { name: '🧹 Salons', value: '`!clear <1-100>` — Supprimer des messages\n`!slowmode <secondes>` — Slowmode\n`!lock` — Verrouiller\n`!unlock` — Déverrouiller' },
        { name: '🎭 Rôles', value: '`!setup-roles #salon "titre" 🎮=Role` — Créer un message de rôles' },
        { name: '🎬 Clips', value: '`!clips` — Voir les clips\n`!testclips` — Lancer le vote\n`!testgagnant` — Annoncer le gagnant' },
        { name: '⚡ SmashCoins', value: '`!solde` — Voir son solde\n`!daily` — Bonus quotidien (50-100 ⚡)\n`!top` — Classement\n`!transfert @user montant` — Envoyer des coins\n`!casino` — Voir les jeux\n`!shop` — Boutique des rôles' },
        { name: '🎰 Casino', value: '`!jackpot <mise>` — Machine à sous\n`!roulette <mise>` — Roulette\n`!pileouface <mise>` — Pile ou Face\n`!duel @user <mise>` — Duel vs un membre' },
        { name: '🔧 Admin seulement', value: '`!addcoins @user montant` — Donner des coins\n`!removecoins @user montant` — Retirer des coins\n`!dashboard` — Dashboard modération' },
      )
      .setFooter({ text: 'Gains passifs : +2⚡ par message (cooldown 1min) • +5⚡ toutes les 10min en vocal • +50-100⚡ daily' });
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