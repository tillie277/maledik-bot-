require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, SlashCommandBuilder, Routes,
  REST, Collection
} = require('discord.js');

const fs = require('fs');
const http = require('http');

// ─── CONFIG FILE ────────────────────────────────────────────────────────────
const CONFIG_FILE = './config.json';
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const def = {
      owners: ['685679698054742017', '465620464232955911'],
      ticketPingRoleId: null,
      superiorRoleId: null,
      ticketCategoryId: null,
      ticketLogChannelId: null,
      ticketPanelChannelId: null,
      embedColor: 0x8B00FF,
      serverName: 'Malédiké',
      panelTitle: 'Contacter le Support Malédiké',
      panelDescription: 'Notre équipe est disponible 24H/24 pour répondre à vos questions et vous accompagner tout au long de votre expérience sur Shibuya!\nVeuillez sélectionner le bouton qui correspond le mieux à votre besoin.',
      panelColor: 0x8B00FF,
      buttons: [
        { id: 'ticket_general', label: 'Support Général', emoji: '🎫', style: 'Primary' },
        { id: 'ticket_report', label: 'Signalement', emoji: '⚠️', style: 'Danger' },
        { id: 'ticket_question', label: 'Question', emoji: '❓', style: 'Secondary' }
      ],
      ticketCount: 0
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ─── CLIENT ─────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ─── KEEP ALIVE (selfping toutes les 30s) ───────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot alive')).listen(PORT, () => {
  console.log(`[KeepAlive] Serveur HTTP lancé sur le port ${PORT}`);
});
setInterval(() => {
  http.get(`http://localhost:${PORT}`, () => {}).on('error', () => {});
}, 30000);

// ─── HELPERS ────────────────────────────────────────────────────────────────
function isOwner(userId) {
  const cfg = loadConfig();
  return cfg.owners.includes(userId);
}

function buttonStyleEnum(styleStr) {
  const map = {
    Primary: ButtonStyle.Primary,
    Secondary: ButtonStyle.Secondary,
    Success: ButtonStyle.Success,
    Danger: ButtonStyle.Danger
  };
  return map[styleStr] || ButtonStyle.Primary;
}

function buildPanelEmbed(cfg) {
  return new EmbedBuilder()
    .setColor(cfg.panelColor || 0x8B00FF)
    .setTitle(cfg.panelTitle)
    .setDescription(cfg.panelDescription)
    .setFooter({ text: cfg.serverName });
}

function buildPanelRows(cfg) {
  const rows = [];
  const buttons = cfg.buttons || [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    const row = new ActionRowBuilder().addComponents(
      chunk.map(b =>
        new ButtonBuilder()
          .setCustomId(b.id)
          .setLabel(b.label)
          .setEmoji(b.emoji || '🎫')
          .setStyle(buttonStyleEnum(b.style || 'Primary'))
      )
    );
    rows.push(row);
  }
  return rows;
}

// ─── SLASH COMMANDS REGISTRATION ────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('[OWNER] Configure le bot ticket')
    .addSubcommand(s => s.setName('panel').setDescription('Envoie le panel de tickets dans ce salon'))
    .addSubcommand(s => s.setName('pingrole').setDescription('Définit le rôle pingé à l\'ouverture d\'un ticket')
      .addRoleOption(o => o.setName('role').setDescription('Rôle à pinger').setRequired(true)))
    .addSubcommand(s => s.setName('superieur').setDescription('Définit le rôle supérieur (gestionnaires)')
      .addRoleOption(o => o.setName('role').setDescription('Rôle supérieur').setRequired(true)))
    .addSubcommand(s => s.setName('category').setDescription('Définit la catégorie où créer les tickets')
      .addChannelOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)))
    .addSubcommand(s => s.setName('logchannel').setDescription('Définit le salon de logs des tickets')
      .addChannelOption(o => o.setName('salon').setDescription('Salon de logs').setRequired(true))),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('[OWNER] Gestion du panel')
    .addSubcommand(s => s.setName('title').setDescription('Modifie le titre de l\'embed panel')
      .addStringOption(o => o.setName('titre').setDescription('Nouveau titre').setRequired(true)))
    .addSubcommand(s => s.setName('description').setDescription('Modifie la description de l\'embed panel')
      .addStringOption(o => o.setName('desc').setDescription('Nouvelle description').setRequired(true)))
    .addSubcommand(s => s.setName('color').setDescription('Modifie la couleur de l\'embed panel (hex sans #)')
      .addStringOption(o => o.setName('couleur').setDescription('Ex: 8B00FF').setRequired(true)))
    .addSubcommand(s => s.setName('addbutton').setDescription('Ajoute un bouton au panel')
      .addStringOption(o => o.setName('id').setDescription('ID unique (ex: ticket_vip)').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Texte du bouton').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji du bouton').setRequired(false))
      .addStringOption(o => o.setName('style').setDescription('Primary/Secondary/Success/Danger').setRequired(false)))
    .addSubcommand(s => s.setName('removebutton').setDescription('Supprime un bouton du panel')
      .addStringOption(o => o.setName('id').setDescription('ID du bouton à supprimer').setRequired(true)))
    .addSubcommand(s => s.setName('listbuttons').setDescription('Liste tous les boutons du panel')),

  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Ajoute un utilisateur au ticket')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur à ajouter').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(false)),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Retire un utilisateur du ticket')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur à retirer').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(false)),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Ferme le ticket avec un compte à rebours'),

  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Supprime immédiatement le ticket'),

  new SlashCommandBuilder()
    .setName('ownerbot')
    .setDescription('[OWNER] Ajoute un owner du bot')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur à ajouter comme owner').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(false))
].map(c => c.toJSON());

// ─── READY ───────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`[Bot] Connecté en tant que ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    const guilds = client.guilds.cache.map(g => g.id);
    for (const guildId of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    }
    console.log('[Commands] Slash commands enregistrées.');
  } catch (e) {
    console.error('[Commands] Erreur enregistrement:', e);
  }
});

// ─── PREFIX COMMANDS ($ownerbot, etc.) ──────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('$')) return;
  const args = message.content.slice(1).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'ownerbot') {
    if (!isOwner(message.author.id)) return message.reply('❌ Tu n\'es pas owner du bot.');
    const mention = message.mentions.users.first();
    const rawId = args[0];
    const targetId = mention ? mention.id : rawId;
    if (!targetId || !/^\d{17,19}$/.test(targetId)) return message.reply('❌ Mentionne un utilisateur ou donne un ID valide.');
    const cfg = loadConfig();
    if (cfg.owners.includes(targetId)) return message.reply('⚠️ Cet utilisateur est déjà owner.');
    cfg.owners.push(targetId);
    saveConfig(cfg);
    return message.reply(`✅ <@${targetId}> a été ajouté comme owner du bot.`);
  }
});

// ─── INTERACTION HANDLER ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  const cfg = loadConfig();

  // ── SLASH COMMANDS ──
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /ownerbot
    if (commandName === 'ownerbot') {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;
      if (!targetId) return interaction.reply({ content: '❌ Donne un utilisateur ou un ID.', ephemeral: true });
      if (cfg.owners.includes(targetId)) return interaction.reply({ content: '⚠️ Déjà owner.', ephemeral: true });
      cfg.owners.push(targetId);
      saveConfig(cfg);
      return interaction.reply({ content: `✅ <@${targetId}> ajouté comme owner.`, ephemeral: true });
    }

    // /setup
    if (commandName === 'setup') {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });
      const sub = interaction.options.getSubcommand();

      if (sub === 'panel') {
        const rows = buildPanelRows(cfg);
        if (rows.length === 0) return interaction.reply({ content: '❌ Aucun bouton configuré. Utilise /panel addbutton d\'abord.', ephemeral: true });
        const embed = buildPanelEmbed(cfg);
        await interaction.channel.send({ embeds: [embed], components: rows });
        cfg.ticketPanelChannelId = interaction.channel.id;
        saveConfig(cfg);
        return interaction.reply({ content: '✅ Panel envoyé !', ephemeral: true });
      }
      if (sub === 'pingrole') {
        const role = interaction.options.getRole('role');
        cfg.ticketPingRoleId = role.id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Rôle pingé : <@&${role.id}>`, ephemeral: true });
      }
      if (sub === 'superieur') {
        const role = interaction.options.getRole('role');
        cfg.superiorRoleId = role.id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Rôle supérieur : <@&${role.id}>`, ephemeral: true });
      }
      if (sub === 'category') {
        const channel = interaction.options.getChannel('categorie');
        cfg.ticketCategoryId = channel.id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Catégorie : ${channel.name}`, ephemeral: true });
      }
      if (sub === 'logchannel') {
        const channel = interaction.options.getChannel('salon');
        cfg.ticketLogChannelId = channel.id;
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Salon de logs : <#${channel.id}>`, ephemeral: true });
      }
    }

    // /panel
    if (commandName === 'panel') {
      if (!isOwner(interaction.user.id)) return interaction.reply({ content: '❌ Tu n\'es pas owner du bot.', ephemeral: true });
      const sub = interaction.options.getSubcommand();

      if (sub === 'title') {
        cfg.panelTitle = interaction.options.getString('titre');
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Titre mis à jour : **${cfg.panelTitle}**`, ephemeral: true });
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
        return interaction.reply({ content: `✅ Couleur mise à jour : #${hex}`, ephemeral: true });
      }
      if (sub === 'addbutton') {
        const id = interaction.options.getString('id');
        const label = interaction.options.getString('label');
        const emoji = interaction.options.getString('emoji') || '🎫';
        const style = interaction.options.getString('style') || 'Primary';
        if (cfg.buttons.find(b => b.id === id)) return interaction.reply({ content: '❌ Un bouton avec cet ID existe déjà.', ephemeral: true });
        cfg.buttons.push({ id, label, emoji, style });
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Bouton **${label}** ajouté. Renvoie le panel avec /setup panel.`, ephemeral: true });
      }
      if (sub === 'removebutton') {
        const id = interaction.options.getString('id');
        const before = cfg.buttons.length;
        cfg.buttons = cfg.buttons.filter(b => b.id !== id);
        if (cfg.buttons.length === before) return interaction.reply({ content: '❌ Bouton introuvable.', ephemeral: true });
        saveConfig(cfg);
        return interaction.reply({ content: `✅ Bouton **${id}** supprimé.`, ephemeral: true });
      }
      if (sub === 'listbuttons') {
        if (cfg.buttons.length === 0) return interaction.reply({ content: 'Aucun bouton configuré.', ephemeral: true });
        const list = cfg.buttons.map(b => `• \`${b.id}\` — ${b.emoji} **${b.label}** (${b.style})`).join('\n');
        return interaction.reply({ content: `**Boutons du panel :**\n${list}`, ephemeral: true });
      }
    }

    // /add
    if (commandName === 'add') {
      if (!interaction.channel.name?.startsWith('ticket-')) return interaction.reply({ content: '❌ Cette commande n\'est utilisable que dans un ticket.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;
      if (!targetId) return interaction.reply({ content: '❌ Mentionne un utilisateur ou donne un ID.', ephemeral: true });
      try {
        await interaction.channel.permissionOverwrites.edit(targetId, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true
        });
        return interaction.reply({ content: `✅ <@${targetId}> a été ajouté au ticket.` });
      } catch {
        return interaction.reply({ content: '❌ Impossible d\'ajouter cet utilisateur.', ephemeral: true });
      }
    }

    // /remove
    if (commandName === 'remove') {
      if (!interaction.channel.name?.startsWith('ticket-')) return interaction.reply({ content: '❌ Cette commande n\'est utilisable que dans un ticket.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const rawId = interaction.options.getString('id');
      const targetId = user ? user.id : rawId;
      if (!targetId) return interaction.reply({ content: '❌ Mentionne un utilisateur ou donne un ID.', ephemeral: true });
      try {
        await interaction.channel.permissionOverwrites.edit(targetId, {
          ViewChannel: false
        });
        return interaction.reply({ content: `✅ <@${targetId}> a été retiré du ticket.` });
      } catch {
        return interaction.reply({ content: '❌ Impossible de retirer cet utilisateur.', ephemeral: true });
      }
    }

    // /close
    if (commandName === 'close') {
      if (!interaction.channel.name?.startsWith('ticket-')) return interaction.reply({ content: '❌ Cette commande n\'est utilisable que dans un ticket.', ephemeral: true });
      const embed = new EmbedBuilder()
        .setColor(0x8B00FF)
        .setTitle('🔒 Fermeture du Ticket')
        .setDescription('Ce ticket sera fermé dans **5 secondes**...')
        .setFooter({ text: cfg.serverName });
      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      let count = 5;
      const interval = setInterval(async () => {
        count--;
        if (count <= 0) {
          clearInterval(interval);
          await interaction.channel.delete().catch(() => {});
        } else {
          const updated = new EmbedBuilder()
            .setColor(0x8B00FF)
            .setTitle('🔒 Fermeture du Ticket')
            .setDescription(`Ce ticket sera fermé dans **${count} seconde${count > 1 ? 's' : ''}**...`)
            .setFooter({ text: cfg.serverName });
          await msg.edit({ embeds: [updated] }).catch(() => {});
        }
      }, 1000);
    }

    // /delete
    if (commandName === 'delete') {
      if (!interaction.channel.name?.startsWith('ticket-')) return interaction.reply({ content: '❌ Cette commande n\'est utilisable que dans un ticket.', ephemeral: true });
      await interaction.reply({ content: '🗑️ Suppression du ticket...' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 1500);
    }

    return;
  }

  // ── BUTTON INTERACTIONS ──
  if (interaction.isButton()) {
    const { customId } = interaction;

    // Panel buttons (ouverture de ticket)
    const btnConfig = cfg.buttons.find(b => b.id === customId);
    if (btnConfig) {
      // Modal pour la raison
      const modal = new ModalBuilder()
        .setCustomId(`ticket_reason_${customId}`)
        .setTitle('Raison du ticket');
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Raison du ticket')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Décrivez votre problème...')
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    // Claim
    if (customId.startsWith('claim_')) {
      const ticketCreatorId = customId.replace('claim_', '');
      // Seul le rôle pingé ou supérieur peut claim
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Erreur.', ephemeral: true });
      const canClaim = (cfg.ticketPingRoleId && member.roles.cache.has(cfg.ticketPingRoleId)) ||
                       (cfg.superiorRoleId && member.roles.cache.has(cfg.superiorRoleId)) ||
                       isOwner(interaction.user.id);
      if (!canClaim) {
        return interaction.reply({ content: '❌ Vous ne pouvez pas claim ce ticket car vous n\'avez pas les permissions.', ephemeral: true });
      }
      // Stocker le claim dans le nom du channel (via topic)
      await interaction.channel.setTopic(`claimed:${interaction.user.id}`).catch(() => {});
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setDescription(`✅ Ticket **claim** par <@${interaction.user.id}>`)
        .setFooter({ text: cfg.serverName });
      return interaction.reply({ embeds: [embed] });
    }

    // Unclaim
    if (customId.startsWith('unclaim_')) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Erreur.', ephemeral: true });
      const canUnclaim = (cfg.ticketPingRoleId && member.roles.cache.has(cfg.ticketPingRoleId)) ||
                         (cfg.superiorRoleId && member.roles.cache.has(cfg.superiorRoleId)) ||
                         isOwner(interaction.user.id);
      if (!canUnclaim) {
        return interaction.reply({ content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'en êtes pas le propriétaire.', ephemeral: true });
      }
      const topic = interaction.channel.topic || '';
      const claimedBy = topic.startsWith('claimed:') ? topic.replace('claimed:', '') : null;
      if (claimedBy && claimedBy !== interaction.user.id && !isOwner(interaction.user.id) &&
          !(cfg.superiorRoleId && member.roles.cache.has(cfg.superiorRoleId))) {
        return interaction.reply({ content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'en êtes pas le propriétaire.', ephemeral: true });
      }
      await interaction.channel.setTopic('').catch(() => {});
      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setDescription(`🔓 Ticket **unclaim** par <@${interaction.user.id}>`)
        .setFooter({ text: cfg.serverName });
      return interaction.reply({ embeds: [embed] });
    }
  }

  // ── MODAL SUBMIT ──
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('ticket_reason_')) {
      const buttonId = interaction.customId.replace('ticket_reason_', '');
      const reason = interaction.fields.getTextInputValue('reason');
      await interaction.deferReply({ ephemeral: true });

      const cfg = loadConfig();
      cfg.ticketCount = (cfg.ticketCount || 0) + 1;
      const ticketNum = String(cfg.ticketCount).padStart(4, '0');
      saveConfig(cfg);

      const guild = interaction.guild;
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);

      // Permissions du salon privé
      const overwrites = [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        }
      ];
      if (cfg.ticketPingRoleId) {
        overwrites.push({
          id: cfg.ticketPingRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }
      if (cfg.superiorRoleId) {
        overwrites.push({
          id: cfg.superiorRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        });
      }

      const channelOptions = {
        name: `ticket-${ticketNum}`,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
        topic: `Ticket de <@${interaction.user.id}>`
      };
      if (cfg.ticketCategoryId) channelOptions.parent = cfg.ticketCategoryId;

      let ticketChannel;
      try {
        ticketChannel = await guild.channels.create(channelOptions);
      } catch (e) {
        return interaction.editReply({ content: '❌ Erreur lors de la création du ticket. Vérifie les permissions du bot.' });
      }

      // Embed principal du ticket (rebord gauche violet)
      const ticketEmbed = new EmbedBuilder()
        .setColor(0x8B00FF)
        .setTitle(`🎫 Ticket Créé #${ticketNum}`)
        .addFields(
          { name: '👤 Créé par', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📋 Catégorie', value: buttonId, inline: true },
          { name: '📝 Raison', value: reason }
        )
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: cfg.serverName })
        .setTimestamp();

      const claimRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_${interaction.user.id}`)
          .setLabel('Claim')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`unclaim_${interaction.user.id}`)
          .setLabel('Unclaim')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger)
      );

      // Ping du rôle
      let pingMsg = `<@${interaction.user.id}>`;
      if (cfg.ticketPingRoleId) pingMsg += ` <@&${cfg.ticketPingRoleId}>`;

      await ticketChannel.send({
        content: pingMsg,
        embeds: [ticketEmbed],
        components: [claimRow]
      });

      // Log
      if (cfg.ticketLogChannelId) {
        const logChannel = guild.channels.cache.get(cfg.ticketLogChannelId);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setColor(0x8B00FF)
            .setTitle('📋 Nouveau Ticket Ouvert')
            .addFields(
              { name: 'Ticket', value: `<#${ticketChannel.id}> — #${ticketNum}`, inline: true },
              { name: 'Créé par', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Raison', value: reason }
            )
            .setTimestamp();
          await logChannel.send({ embeds: [logEmbed] });
        }
      }

      return interaction.editReply({ content: `✅ Ton ticket a été créé : <#${ticketChannel.id}>` });
    }
  }
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────
client.login(process.env.TOKEN);
