// ════════════════════════════════════════════════════════════════════════════
//  BOT TICKET — MALÉDIKÉ  |  index.js
//  • Statut Twitch streaming  /gg.maledike
//  • Keep-alive HTTP + reconnexion automatique
//  • /panel removebutton → appuyer sur le bouton à supprimer
//  • Rôle ping par bouton (configurable)
//  • Claim/Unclaim sécurisé
//  • /add /remove /close (compte à rebours) /delete
//  • $ownerbot / /ownerbot
// ════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType, SlashCommandBuilder,
  Routes, REST, ActivityType
} = require('discord.js');

const fs   = require('fs');
const http = require('http');

// ══════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════
const CONFIG_FILE = './config.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const def = {
      owners: ['685679698054742017', '465620464232955911'],
      superiorRoleId:      null,
      ticketCategoryId:    null,
      ticketLogChannelId:  null,
      serverName:          'Malédiké',
      panelTitle:          'Contacter le Support Malédiké',
      panelDescription:    'Notre équipe est disponible 24H/24 pour répondre à vos questions et vous accompagner tout au long de votre expérience sur Shibuya!\nVeuillez sélectionner le bouton qui correspond le mieux à votre besoin.',
      panelColor:          0x8B00FF,
      // Chaque bouton a son propre pingRoleId
      buttons: [
        { id: 'ticket_general',  label: 'Support Général', emoji: '🎫', style: 'Primary',   pingRoleId: null },
        { id: 'ticket_report',   label: 'Signalement',     emoji: '⚠️', style: 'Danger',    pingRoleId: null },
        { id: 'ticket_question', label: 'Question',        emoji: '❓', style: 'Secondary', pingRoleId: null }
      ],
      ticketCount: 0,
      // mode temporaire : si non-null, l'owner qui a lancé /panel removebutton attend un clic
      pendingRemove: null
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ══════════════════════════════════════════════════════════
//  CLIENT
// ══════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ══════════════════════════════════════════════════════════
//  KEEP-ALIVE  (HTTP interne + reconnexion Discord auto)
// ══════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Malédiké — alive ✅');
}).listen(PORT, () => console.log(`[KeepAlive] HTTP sur le port ${PORT}`));

// Self-ping silencieux toutes les 30 secondes (évite le sleep Render)
setInterval(() => {
  http.get(`http://localhost:${PORT}`, () => {}).on('error', () => {});
}, 30_000);

// Auto-reconnexion si le bot se déconnecte
client.on('disconnect', () => {
  console.warn('[Discord] Déconnecté — tentative de reconnexion...');
  setTimeout(() => client.login(process.env.TOKEN).catch(console.error), 5_000);
});
client.on('error', (err) => {
  console.error('[Discord] Erreur WS :', err.message);
});

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function isOwner(userId) {
  return loadConfig().owners.includes(String(userId));
}

const STYLE_MAP = {
  Primary:   ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success:   ButtonStyle.Success,
  Danger:    ButtonStyle.Danger
};
function btnStyle(s) { return STYLE_MAP[s] || ButtonStyle.Primary; }

/** Construit l'embed principal du panel */
function buildPanelEmbed(cfg) {
  return new EmbedBuilder()
    .setColor(cfg.panelColor ?? 0x8B00FF)
    .setTitle(cfg.panelTitle)
    .setDescription(cfg.panelDescription)
    .setFooter({ text: cfg.serverName });
}

/** Construit les rangées de boutons du panel (max 5 par rangée) */
function buildPanelRows(cfg) {
  const rows = [];
  const btns = cfg.buttons ?? [];
  for (let i = 0; i < btns.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        btns.slice(i, i + 5).map(b =>
          new ButtonBuilder()
            .setCustomId(b.id)
            .setLabel(b.label)
            .setEmoji(b.emoji || '🎫')
            .setStyle(btnStyle(b.style || 'Primary'))
        )
      )
    );
  }
  return rows;
}

/**
 * Construit le panel "suppression de bouton" :
 * chaque bouton existant devient cliquable pour le supprimer.
 */
function buildRemoveRows(cfg) {
  const rows = [];
  const btns = cfg.buttons ?? [];
  for (let i = 0; i < btns.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        btns.slice(i, i + 5).map(b =>
          new ButtonBuilder()
            .setCustomId(`remove_btn_${b.id}`)
            .setLabel(`🗑️ ${b.label}`)
            .setStyle(ButtonStyle.Danger)
        )
      )
    );
  }
  return rows;
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS DEFINITIONS
// ══════════════════════════════════════════════════════════
const commands = [

  // ── /setup ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('[OWNER] Configure le bot ticket')
    .addSubcommand(s => s
      .setName('panel')
      .setDescription('Envoie le panel dans ce salon'))
    .addSubcommand(s => s
      .setName('superieur')
      .setDescription('Rôle supérieur (gestionnaires, non pingé mais accès aux tickets)')
      .addRoleOption(o => o.setName('role').setDescription('Rôle supérieur').setRequired(true)))
    .addSubcommand(s => s
      .setName('category')
      .setDescription('Catégorie où créer les tickets')
      .addChannelOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)))
    .addSubcommand(s => s
      .setName('logchannel')
      .setDescription('Salon de logs des tickets')
      .addChannelOption(o => o.setName('salon').setDescription('Salon logs').setRequired(true))),

  // ── /panel ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('[OWNER] Gestion du panel')
    .addSubcommand(s => s
      .setName('title')
      .setDescription('Modifie le titre de l\'embed')
      .addStringOption(o => o.setName('titre').setDescription('Nouveau titre').setRequired(true)))
    .addSubcommand(s => s
      .setName('description')
      .setDescription('Modifie la description de l\'embed')
      .addStringOption(o => o.setName('desc').setDescription('Nouvelle description').setRequired(true)))
    .addSubcommand(s => s
      .setName('color')
      .setDescription('Modifie la couleur (hex sans #)')
      .addStringOption(o => o.setName('couleur').setDescription('Ex: 8B00FF').setRequired(true)))
    .addSubcommand(s => s
      .setName('addbutton')
      .setDescription('Ajoute un bouton au panel')
      .addStringOption(o => o.setName('id').setDescription('ID unique, ex: ticket_vip').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Texte du bouton').setRequired(true))
      .addRoleOption(o => o.setName('pingrole').setDescription('Rôle pingé pour ce bouton').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(false))
      .addStringOption(o => o.setName('style').setDescription('Primary/Secondary/Success/Danger').setRequired(false)))
    .addSubcommand(s => s
      .setName('removebutton')
      .setDescription('Clique sur le bouton à supprimer'))
    .addSubcommand(s => s
      .setName('setpingrole')
      .setDescription('Modifie le rôle pingé d\'un bouton existant')
      .addStringOption(o => o.setName('id').setDescription('ID du bouton').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Nouveau rôle pingé').setRequired(true)))
    .addSubcommand(s => s
      .setName('listbuttons')
      .setDescription('Liste tous les boutons avec leurs rôles')),

  // ── /add ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Ajoute un utilisateur au ticket')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID Discord').setRequired(false)),

  // ── /remove ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Retire un utilisateur du ticket')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID Discord').setRequired(false)),

  // ── /close ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Ferme le ticket (compte à rebours 5→0)'),

  // ── /delete ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Supprime immédiatement le ticket'),

  // ── /ownerbot ───────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ownerbot')
    .setDescription('[OWNER] Ajoute un owner du bot')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID Discord').setRequired(false))

].map(c => c.toJSON());

// ══════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════
client.once('ready', async () => {
  console.log(`[Bot] Connecté en tant que ${client.user.tag}`);

  // ── Statut Twitch streaming ──────────────────────────────
  client.user.setPresence({
    status: 'online',
    activities: [{
      name:  'gg.maledike',
      type:  ActivityType.Streaming,
      url:   'https://www.twitch.tv/gg_maledike'   // URL Twitch obligatoire pour le badge streaming
    }]
  });

  // ── Enregistrement des slash commands ───────────────────
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    for (const guildId of client.guilds.cache.map(g => g.id)) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commands }
      );
    }
    console.log('[Commands] Slash commands enregistrées avec succès.');
  } catch (e) {
    console.error('[Commands] Erreur :', e);
  }
});

// ══════════════════════════════════════════════════════════
//  PREFIX COMMANDS  ($ownerbot)
// ══════════════════════════════════════════════════════════
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('$')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const cmd  = args.shift().toLowerCase();

  if (cmd === 'ownerbot') {
    if (!isOwner(message.author.id))
      return message.reply('❌ Tu n\'es pas owner du bot.');

    const mention  = message.mentions.users.first();
    const targetId = mention ? mention.id : args[0];

    if (!targetId || !/^\d{17,19}$/.test(targetId))
      return message.reply('❌ Mentionne un utilisateur ou donne un ID valide.');

    const cfg = loadConfig();
    if (cfg.owners.includes(targetId))
      return message.reply('⚠️ Cet utilisateur est déjà owner du bot.');

    cfg.owners.push(targetId);
    saveConfig(cfg);
    return message.reply(`✅ <@${targetId}> ajouté comme owner du bot.`);
  }
});

// ══════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ══════════════════════════════════════════════════════════
client.on('interactionCreate', async (interaction) => {
  let cfg = loadConfig();

  // ────────────────────────────────────────────────────────
  //  SLASH COMMANDS
  // ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // ── /ownerbot ────────────────────────────────────────
    if (commandName === 'ownerbot') {
      if (!isOwner(interaction.user.id))
        return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });

      const user     = interaction.options.getUser('user');
      const rawId    = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;

      if (!targetId)
        return interaction.reply({ content: '❌ Donne un utilisateur ou un ID.', ephemeral: true });
      if (cfg.owners.includes(targetId))
        return interaction.reply({ content: '⚠️ Déjà owner.', ephemeral: true });

      cfg.owners.push(targetId);
      saveConfig(cfg);
      return interaction.reply({ content: `✅ <@${targetId}> ajouté comme owner du bot.`, ephemeral: true });
    }

    // ── /setup ───────────────────────────────────────────
    if (commandName === 'setup') {
      if (!isOwner(interaction.user.id))
        return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === 'panel') {
        const rows = buildPanelRows(cfg);
        if (!rows.length)
          return interaction.reply({ content: '❌ Aucun bouton configuré. Utilise `/panel addbutton` d\'abord.', ephemeral: true });

        await interaction.channel.send({ embeds: [buildPanelEmbed(cfg)], components: rows });
        return interaction.reply({ content: '✅ Panel envoyé !', ephemeral: true });
      }

      if (sub === 'superieur') {
        cfg.superiorRoleId = interaction.options.getRole('role').id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Rôle supérieur : <@&${cfg.superiorRoleId}>`, ephemeral: true });
      }

      if (sub === 'category') {
        cfg.ticketCategoryId = interaction.options.getChannel('categorie').id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Catégorie définie.`, ephemeral: true });
      }

      if (sub === 'logchannel') {
        cfg.ticketLogChannelId = interaction.options.getChannel('salon').id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Salon de logs : <#${cfg.ticketLogChannelId}>`, ephemeral: true });
      }
    }

    // ── /panel ───────────────────────────────────────────
    if (commandName === 'panel') {
      if (!isOwner(interaction.user.id))
        return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === 'title') {
        cfg.panelTitle = interaction.options.getString('titre');
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Titre : **${cfg.panelTitle}**`, ephemeral: true });
      }

      if (sub === 'description') {
        cfg.panelDescription = interaction.options.getString('desc');
        saveConfig(cfg);
        return interaction.reply({ content: '✅ Description mise à jour.', ephemeral: true });
      }

      if (sub === 'color') {
        const hex = interaction.options.getString('couleur').replace('#', '');
        cfg.panelColor = parseInt(hex, 16);
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Couleur : #${hex.toUpperCase()}`, ephemeral: true });
      }

      if (sub === 'addbutton') {
        const id       = interaction.options.getString('id');
        const label    = interaction.options.getString('label');
        const role     = interaction.options.getRole('pingrole');
        const emoji    = interaction.options.getString('emoji')  ?? '🎫';
        const style    = interaction.options.getString('style')  ?? 'Primary';

        if (cfg.buttons.find(b => b.id === id))
          return interaction.reply({ content: `❌ Un bouton avec l'ID \`${id}\` existe déjà.`, ephemeral: true });

        cfg.buttons.push({ id, label, emoji, style, pingRoleId: role.id });
        saveConfig(cfg);
        return interaction.reply({
          content: `✅ Bouton **${label}** ajouté (ping : <@&${role.id}>).\nPense à renvoyer le panel avec \`/setup panel\`.`,
          ephemeral: true
        });
      }

      if (sub === 'setpingrole') {
        const id   = interaction.options.getString('id');
        const role = interaction.options.getRole('role');
        const btn  = cfg.buttons.find(b => b.id === id);
        if (!btn)
          return interaction.reply({ content: `❌ Bouton \`${id}\` introuvable.`, ephemeral: true });

        btn.pingRoleId = role.id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Rôle pingé pour **${btn.label}** → <@&${role.id}>`, ephemeral: true });
      }

      // ── /panel removebutton ─ affiche les boutons à cliquer ──
      if (sub === 'removebutton') {
        if (!cfg.buttons.length)
          return interaction.reply({ content: '❌ Aucun bouton à supprimer.', ephemeral: true });

        const removeRows = buildRemoveRows(cfg);

        // On marque que cet owner est en "mode suppression"
        cfg.pendingRemove = interaction.user.id;
        saveConfig(cfg);

        const embed = new EmbedBuilder()
          .setColor(0xFF4444)
          .setTitle('🗑️ Supprimer un bouton')
          .setDescription('Clique sur le bouton que tu veux supprimer du panel.');

        return interaction.reply({ embeds: [embed], components: removeRows, ephemeral: true });
      }

      if (sub === 'listbuttons') {
        if (!cfg.buttons.length)
          return interaction.reply({ content: 'Aucun bouton configuré.', ephemeral: true });

        const list = cfg.buttons.map(b =>
          `• \`${b.id}\` — ${b.emoji} **${b.label}** | Style: ${b.style} | Ping: ${b.pingRoleId ? `<@&${b.pingRoleId}>` : '*aucun*'}`
        ).join('\n');

        return interaction.reply({ content: `**Boutons du panel :**\n${list}`, ephemeral: true });
      }
    }

    // ── /add ─────────────────────────────────────────────
    if (commandName === 'add') {
      if (!interaction.channel.name?.startsWith('ticket-'))
        return interaction.reply({ content: '❌ Utilisable uniquement dans un ticket.', ephemeral: true });

      const user     = interaction.options.getUser('user');
      const rawId    = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;

      if (!targetId)
        return interaction.reply({ content: '❌ Mentionne un utilisateur ou donne un ID.', ephemeral: true });

      try {
        await interaction.channel.permissionOverwrites.edit(targetId, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true
        });
        return interaction.reply({ content: `✅ <@${targetId}> ajouté au ticket.` });
      } catch {
        return interaction.reply({ content: '❌ Impossible d\'ajouter cet utilisateur.', ephemeral: true });
      }
    }

    // ── /remove ──────────────────────────────────────────
    if (commandName === 'remove') {
      if (!interaction.channel.name?.startsWith('ticket-'))
        return interaction.reply({ content: '❌ Utilisable uniquement dans un ticket.', ephemeral: true });

      const user     = interaction.options.getUser('user');
      const rawId    = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;

      if (!targetId)
        return interaction.reply({ content: '❌ Mentionne un utilisateur ou donne un ID.', ephemeral: true });

      try {
        await interaction.channel.permissionOverwrites.edit(targetId, { ViewChannel: false });
        return interaction.reply({ content: `✅ <@${targetId}> retiré du ticket.` });
      } catch {
        return interaction.reply({ content: '❌ Impossible de retirer cet utilisateur.', ephemeral: true });
      }
    }

    // ── /close ───────────────────────────────────────────
    if (commandName === 'close') {
      if (!interaction.channel.name?.startsWith('ticket-'))
        return interaction.reply({ content: '❌ Utilisable uniquement dans un ticket.', ephemeral: true });

      const buildCloseEmbed = (n) => new EmbedBuilder()
        .setColor(0x8B00FF)
        .setTitle('🔒 Fermeture du Ticket')
        .setDescription(
          n > 0
            ? `Ce ticket sera fermé dans **${n} seconde${n > 1 ? 's' : ''}**...`
            : '🔒 Fermeture en cours...'
        )
        .setFooter({ text: cfg.serverName });

      const msg = await interaction.reply({ embeds: [buildCloseEmbed(5)], fetchReply: true });
      let count = 4;

      const iv = setInterval(async () => {
        if (count <= 0) {
          clearInterval(iv);
          await interaction.channel.delete().catch(() => {});
          return;
        }
        await msg.edit({ embeds: [buildCloseEmbed(count)] }).catch(() => {});
        count--;
      }, 1_000);
    }

    // ── /delete ──────────────────────────────────────────
    if (commandName === 'delete') {
      if (!interaction.channel.name?.startsWith('ticket-'))
        return interaction.reply({ content: '❌ Utilisable uniquement dans un ticket.', ephemeral: true });

      await interaction.reply({ content: '🗑️ Suppression du ticket...' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 1_500);
    }

    return;
  } // end isChatInputCommand

  // ────────────────────────────────────────────────────────
  //  BUTTON INTERACTIONS
  // ────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { customId } = interaction;

    // ── Suppression de bouton (mode pendingRemove) ───────
    if (customId.startsWith('remove_btn_')) {
      // Seul l'owner qui a lancé la commande peut cliquer
      if (cfg.pendingRemove !== interaction.user.id)
        return interaction.reply({ content: '❌ Ce menu ne t\'appartient pas.', ephemeral: true });

      const btnId = customId.replace('remove_btn_', '');
      const before = cfg.buttons.length;
      cfg.buttons = cfg.buttons.filter(b => b.id !== btnId);

      if (cfg.buttons.length === before) {
        cfg.pendingRemove = null;
        saveConfig(cfg);
        return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });
      }

      cfg.pendingRemove = null;
      saveConfig(cfg);
      return interaction.update({
        content: `✅ Bouton \`${btnId}\` supprimé. Renvoie le panel avec \`/setup panel\`.`,
        embeds: [],
        components: []
      });
    }

    // ── Claim ────────────────────────────────────────────
    if (customId.startsWith('claim_')) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Erreur membre.', ephemeral: true });

      // Récupérer le pingRoleId lié à ce ticket via le topic
      const topic     = interaction.channel.topic || '';
      const btnIdMatch = topic.match(/btnId:([^|]+)/);
      const ticketBtnId = btnIdMatch ? btnIdMatch[1] : null;
      const btnDef    = ticketBtnId ? cfg.buttons.find(b => b.id === ticketBtnId) : null;
      const pingRoleId = btnDef?.pingRoleId ?? null;

      const canAct =
        (pingRoleId           && member.roles.cache.has(pingRoleId))       ||
        (cfg.superiorRoleId   && member.roles.cache.has(cfg.superiorRoleId)) ||
        isOwner(interaction.user.id);

      if (!canAct)
        return interaction.reply({
          content: '❌ Vous ne pouvez pas claim ce ticket car vous n\'avez pas les permissions.',
          ephemeral: true
        });

      await interaction.channel.setTopic(
        topic.replace(/claimed:[^|]*/g, '').trim() + `|claimed:${interaction.user.id}`
      ).catch(() => {});

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00CC66)
            .setDescription(`✅ Ticket **claim** par <@${interaction.user.id}>`)
            .setFooter({ text: cfg.serverName })
        ]
      });
    }

    // ── Unclaim ──────────────────────────────────────────
    if (customId.startsWith('unclaim_')) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Erreur membre.', ephemeral: true });

      const topic      = interaction.channel.topic || '';
      const claimedMatch = topic.match(/claimed:(\d+)/);
      const claimedBy  = claimedMatch ? claimedMatch[1] : null;

      const btnIdMatch  = topic.match(/btnId:([^|]+)/);
      const ticketBtnId = btnIdMatch ? btnIdMatch[1] : null;
      const btnDef     = ticketBtnId ? cfg.buttons.find(b => b.id === ticketBtnId) : null;
      const pingRoleId  = btnDef?.pingRoleId ?? null;

      const canAct =
        (pingRoleId           && member.roles.cache.has(pingRoleId))       ||
        (cfg.superiorRoleId   && member.roles.cache.has(cfg.superiorRoleId)) ||
        isOwner(interaction.user.id);

      if (!canAct)
        return interaction.reply({
          content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'avez pas les permissions.',
          ephemeral: true
        });

      if (claimedBy &&
          claimedBy !== interaction.user.id &&
          !isOwner(interaction.user.id) &&
          !(cfg.superiorRoleId && member.roles.cache.has(cfg.superiorRoleId))) {
        return interaction.reply({
          content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'en êtes pas le propriétaire.',
          ephemeral: true
        });
      }

      await interaction.channel.setTopic(
        topic.replace(/\|?claimed:\d+/g, '').trim()
      ).catch(() => {});

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setDescription(`🔓 Ticket **unclaim** par <@${interaction.user.id}>`)
            .setFooter({ text: cfg.serverName })
        ]
      });
    }

    // ── Boutons du panel (ouverture de ticket) ───────────
    const btnConfig = cfg.buttons.find(b => b.id === customId);
    if (btnConfig) {
      const modal = new ModalBuilder()
        .setCustomId(`ticket_reason_${customId}`)
        .setTitle('Raison du ticket');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Raison du ticket')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Décrivez votre besoin...')
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }
  } // end isButton

  // ────────────────────────────────────────────────────────
  //  MODAL SUBMIT
  // ────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith('ticket_reason_')) return;

    const buttonId = interaction.customId.replace('ticket_reason_', '');
    const reason   = interaction.fields.getTextInputValue('reason');

    await interaction.deferReply({ ephemeral: true });
    cfg = loadConfig(); // refresh

    cfg.ticketCount = (cfg.ticketCount ?? 0) + 1;
    const ticketNum = String(cfg.ticketCount).padStart(4, '0');
    saveConfig(cfg);

    const guild    = interaction.guild;
    const btnDef   = cfg.buttons.find(b => b.id === buttonId);
    const pingRole = btnDef?.pingRoleId ?? null;

    // Permissions du salon privé
    const overwrites = [
      { id: guild.roles.everyone.id,   deny:  [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];
    if (pingRole)           overwrites.push({ id: pingRole,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    if (cfg.superiorRoleId) overwrites.push({ id: cfg.superiorRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const channelOpts = {
      name:               `ticket-${ticketNum}`,
      type:               ChannelType.GuildText,
      permissionOverwrites: overwrites,
      // Le topic stocke le btnId et le créateur pour claim/unclaim
      topic: `btnId:${buttonId}|creator:${interaction.user.id}`
    };
    if (cfg.ticketCategoryId) channelOpts.parent = cfg.ticketCategoryId;

    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create(channelOpts);
    } catch (e) {
      console.error('[Ticket] Création échouée :', e);
      return interaction.editReply({ content: '❌ Impossible de créer le ticket. Vérifie les permissions du bot.' });
    }

    // Embed du ticket (rebord violet)
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x8B00FF)
      .setTitle(`🎫 Ticket Créé #${ticketNum}`)
      .addFields(
        { name: '👤 Créé par',   value: `<@${interaction.user.id}>`,          inline: true  },
        { name: '📋 Catégorie',  value: btnDef ? btnDef.label : buttonId,     inline: true  },
        { name: '📝 Raison',     value: reason                                               }
      )
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: cfg.serverName })
      .setTimestamp();

    const claimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`claim_${interaction.user.id}`).setLabel('Claim').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`unclaim_${interaction.user.id}`).setLabel('Unclaim').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );

    // Ping : le créateur + le rôle du bouton
    let pingContent = `<@${interaction.user.id}>`;
    if (pingRole) pingContent += ` <@&${pingRole}>`;

    await ticketChannel.send({ content: pingContent, embeds: [ticketEmbed], components: [claimRow] });

    // Log
    if (cfg.ticketLogChannelId) {
      const logCh = guild.channels.cache.get(cfg.ticketLogChannelId);
      if (logCh) {
        await logCh.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x8B00FF)
              .setTitle('📋 Nouveau Ticket Ouvert')
              .addFields(
                { name: 'Ticket',   value: `<#${ticketChannel.id}> — #${ticketNum}`, inline: true },
                { name: 'Créé par', value: `<@${interaction.user.id}>`,              inline: true },
                { name: 'Raison',   value: reason }
              )
              .setTimestamp()
          ]
        }).catch(() => {});
      }
    }

    return interaction.editReply({ content: `✅ Ton ticket a été créé : <#${ticketChannel.id}>` });
  }
});

// ══════════════════════════════════════════════════════════
//  LOGIN  (avec retry automatique)
// ══════════════════════════════════════════════════════════
function login() {
  client.login(process.env.TOKEN).catch(err => {
    console.error('[Login] Échec, nouvelle tentative dans 10s :', err.message);
    setTimeout(login, 10_000);
  });
}
login();
