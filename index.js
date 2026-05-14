require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

const CONFIG_FILE = './config.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

// Commande !setup-roles
// Utilisation : !setup-roles #canal "Titre du message" 🎮=RoleGaming 🎵=RoleMusique
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.member.permissions.has('Administrator')) return;

  if (message.content.startsWith('!setup-roles')) {
    const args = message.content.split(' ');
    args.shift(); // enlève !setup-roles

    // Récupère le canal mentionné
    const channel = message.mentions.channels.first();
    if (!channel) {
      return message.reply('❌ Mentionne un canal ! Ex: `!setup-roles #roles "Choisis ton rôle" 🎮=RoleGaming`');
    }
    args.shift(); // enlève le canal

    // Récupère le titre entre guillemets
    const titreMatch = message.content.match(/"([^"]+)"/);
    if (!titreMatch) {
      return message.reply('❌ Mets le titre entre guillemets ! Ex: `"Choisis ton rôle"`');
    }
    const titre = titreMatch[1];

    // Enlève le titre des args
    const restArgs = args.filter(a => !a.startsWith('"') && !a.endsWith('"') && !a.includes(titre));

    // Parse les paires emoji=Role
    const roles = {};
    const lignes = [];
    for (const arg of restArgs) {
      if (arg.includes('=')) {
        const [emoji, roleName] = arg.split('=');
        const role = message.guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
          return message.reply(`❌ Le rôle \`${roleName}\` n'existe pas sur ce serveur !`);
        }
        roles[emoji] = role.id;
        lignes.push(`${emoji} → **${roleName}**`);
      }
    }

    if (Object.keys(roles).length === 0) {
      return message.reply('❌ Aucun rôle trouvé ! Ex: `🎮=RoleGaming 🎵=RoleMusique`');
    }

    // Crée l'embed
    const embed = new EmbedBuilder()
      .setTitle(titre)
      .setDescription(`Réagis avec un emoji pour obtenir ton rôle !\n\n${lignes.join('\n')}`)
      .setColor(0x5865F2)
      .setFooter({ text: 'Réagis pour obtenir un rôle • Retire ta réaction pour le perdre' });

    // Envoie le message dans le canal cible
    const roleMessage = await channel.send({ embeds: [embed] });

    // Ajoute les réactions automatiquement
    for (const emoji of Object.keys(roles)) {
      await roleMessage.react(emoji);
    }

    // Sauvegarde la config
    const config = loadConfig();
    config[roleMessage.id] = {
      guildId: message.guild.id,
      channelId: channel.id,
      roles: roles,
    };
    saveConfig(config);

    message.reply(`✅ Message de rôles créé dans ${channel} !`);
  }
});

// Quand quelqu'un ajoute une réaction
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
console.log('Emoji reçu:', reaction.emoji.name);
console.log('Message ID:', reaction.message.id);
console.log('Config:', JSON.stringify(loadConfig()));

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

// Quand quelqu'un retire une réaction
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
