require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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
  // Insultes françaises
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
  'couillon', 'andouille', 'branleur', 'branleuse',
  'bite', 'couilles',
  // Menaces françaises
  'je vais te tuer', 'je vais te defoncer', 'je vais te niquer',
  'je vais te latter', 'je vais te peter la gueule', 'je vais te casser',
  'tu vas morfler', 'tu vas prendre', 'viens te battre',
  'je te retrouve', 'je sais ou tu habites', 'tu vas regretter',
  // Insultes anglaises
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick',
  'pussy', 'motherfucker', 'stfu', 'kys', 'moron', 'dumbass',
  'shut up', 'go to hell', 'go die', 'kill yourself',
  'jackass', 'dipshit', 'douche', 'douchebag', 'scumbag', 'jerk',
  'prick', 'wanker', 'twat', 'tosser', 'dimwit', 'halfwit', 'nitwit',
  // Menaces anglaises
  'i will kill you', 'i will hurt you', 'i know where you live',
  'you will regret', 'come fight me', 'i will find you',
];

// Normalise le texte pour contourner les tentatives d'évitement
function normaliser(texte) {
  return texte
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/[^a-z\s]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// ==================== ANTI-SPAM ====================

const spamMap = new Map();
const SPAM_LIMITE = 5;
const SPAM_INTERVALLE = 3000;

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

  try {
    if (nbWarns === 1) {
      await member.send(`⚠️ **Avertissement (1/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain avertissement : mute 10 minutes.`);
      console.log(`⚠️ Avertissement 1 envoyé à ${tag}`);

    } else if (nbWarns === 2) {
      await member.timeout(10 * 60 * 1000, raison);
      await member.send(`🔇 **Mute 10 minutes (2/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain avertissement : mute 24 heures.`);
      console.log(`🔇 Mute 10min appliqué à ${tag}`);

    } else if (nbWarns === 3) {
      await member.timeout(24 * 60 * 60 * 1000, raison);
      await member.send(`🔇 **Mute 24 heures (3/4)** sur **${member.guild.name}**\nRaison : ${raison}\n\nProchain avertissement : ban définitif.`);
      console.log(`🔇 Mute 24h appliqué à ${tag}`);

    } else if (nbWarns >= 4) {
      await member.send(`🔨 **Ban définitif (4/4)** sur **${member.guild.name}**\nRaison : ${raison}`);
      await member.ban({ reason: raison });
      console.log(`🔨 Ban appliqué à ${tag}`);
    }
  } catch (err) {
    console.error(`Erreur sanction sur ${tag}:`, err.message);
  }
}

// ==================== READY ====================

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

// ==================== MESSAGES ====================

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const member = message.member;
  const estAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

  if (!estAdmin) {
    const contenuNormalise = normaliser(message.content);

    // --- Mots interdits ---
    const motTrouve = MOTS_INTERDITS.find(mot => contenuNormalise.includes(normaliser(mot)));
    if (motTrouve) {
      await message.delete().catch(() => {});
      const avert = await message.channel.send(`⚠️ ${member}, ce mot n'est pas autorisé ici.`);
      setTimeout(() => avert.delete().catch(() => {}), 5000);
      await sanctionner(member, `Mot interdit : "${motTrouve}"`);
      return;
    }

    // --- Anti-spam ---
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

  // ==================== COMMANDES ADMIN ====================

  if (!estAdmin) return;

  // --- !setup-roles ---
  if (message.content.startsWith('!setup-roles')) {
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply('❌ Mentionne un canal ! Ex: `!setup-roles #roles "Titre" 🎮=RoleGaming`');

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
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!warns @user`');

    const warns = loadWarns();
    const nb = warns[message.guild.id]?.[user.id] || 0;
    message.reply(`⚠️ **${user.tag}** a **${nb}/4** avertissement(s).`);
  }

  // --- !resetwarns @user ---
  if (message.content.startsWith('!resetwarns')) {
    const user = message.mentions.users.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!resetwarns @user`');

    const warns = loadWarns();
    if (warns[message.guild.id]) warns[message.guild.id][user.id] = 0;
    saveWarns(warns);
    message.reply(`✅ Avertissements de **${user.tag}** remis à zéro.`);
  }

  // --- !warn @user raison ---
  if (message.content.startsWith('!warn')) {
    const user = message.mentions.members.first();
    if (!user) return message.reply('❌ Mentionne un utilisateur ! Ex: `!warn @user raison`');

    const raison = message.content.split(' ').slice(2).join(' ') || 'Aucune raison fournie';
    await sanctionner(user, raison);
    message.reply(`✅ **${user.user.tag}** a été sanctionné. Raison : ${raison}`);
  }
});

// ==================== REACTIONS ====================

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

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
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

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