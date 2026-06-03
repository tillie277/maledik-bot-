require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const http    = require('http');
const https   = require('https');

// ─── Token ───────────────────────────────────────────────────────
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('❌  TOKEN manquant dans .env !');
  process.exit(1);
}

// ================================================================
//  CONFIG  (sauvegardée dans config.json)
// ================================================================

const CFG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  owners:           ['685679698054742017', '465620464232955911'],
  supportRoleId:    null,   // rôle pingé + autorisé à claim/unclaim
  seniorRoleId:     null,   // rôle superviseur (voit les tickets, non pingé)
  ticketCategoryId: null,   // catégorie Discord où créer les salons
  panelChannelId:   null,   // salon où le panel a été envoyé
  ticketCounter:    0,
  categories: [
    { id: 'support',      label: 'Support',      emoji: '🎫', style: 'Primary'   },
    { id: 'signalement',  label: 'Signalement',  emoji: '🚨', style: 'Danger'    },
    { id: 'partenariat',  label: 'Partenariat',  emoji: '🤝', style: 'Secondary' },
  ],
  panelTitle:
    'Contacter le Support malédiké',
  panelDescription:
    'Notre équipe est disponible 24H/24 pour répondre à vos questions et vous ' +
    'accompagner tout au long de votre expérience sur Shibuya!\n' +
    'Veuillez sélectionner le bouton qui correspond le mieux à votre besoin',
  openTickets: {},
  // openTickets format : { channelId: { userId, category, reason, claimed,
  //                                      claimedBy, ticketNumber, createdAt } }
};

function loadCfg() {
  if (!fs.existsSync(CFG_PATH)) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
}

function saveCfg(c) {
  fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2));
}

// ================================================================
//  CLIENT
// ================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ================================================================
//  DÉFINITION DES COMMANDES SLASH
// ================================================================

const CMDS = [

  // /setup — envoie le panel dans un salon
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('📋 Envoie le panel tickets dans un salon [OWNER]')
    .addChannelOption(o =>
      o.setName('salon').setDescription('Salon cible').setRequired(true)),

  // /panel — rafraîchit le panel
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('🔄 Rafraîchit le panel dans le salon configuré [OWNER]'),

  // /config — tout configurer
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('⚙️  Configurer le bot [OWNER]')
    .addSubcommand(s => s
      .setName('role_support')
      .setDescription('Rôle pingé à l\'ouverture d\'un ticket (peut claim/unclaim)')
      .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)))
    .addSubcommand(s => s
      .setName('role_senior')
      .setDescription('Rôle senior (voit les tickets, non pingé)')
      .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)))
    .addSubcommand(s => s
      .setName('ticket_category')
      .setDescription('Catégorie Discord où créer les salons de ticket')
      .addChannelOption(o => o.setName('categorie').setDescription('Catégorie Discord').setRequired(true)))
    .addSubcommand(s => s
      .setName('category_add')
      .setDescription('Ajouter un bouton/catégorie de ticket')
      .addStringOption(o => o.setName('id').setDescription('ID unique (sans espace ex: ban_appeal)').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Texte affiché sur le bouton').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji du bouton (optionnel)').setRequired(false))
      .addStringOption(o => o.setName('style').setDescription('Couleur du bouton').setRequired(false)
        .addChoices(
          { name: '🔵 Bleu  (Primary)',   value: 'Primary'   },
          { name: '⚫ Gris  (Secondary)', value: 'Secondary' },
          { name: '🟢 Vert  (Success)',   value: 'Success'   },
          { name: '🔴 Rouge (Danger)',    value: 'Danger'    },
        )))
    .addSubcommand(s => s
      .setName('category_remove')
      .setDescription('Supprimer une catégorie de ticket')
      .addStringOption(o => o.setName('id').setDescription('ID de la catégorie').setRequired(true)))
    .addSubcommand(s => s
      .setName('category_list')
      .setDescription('Lister toutes les catégories de ticket'))
    .addSubcommand(s => s
      .setName('panel_titre')
      .setDescription('Modifier le titre du panel')
      .addStringOption(o => o.setName('titre').setDescription('Nouveau titre').setRequired(true)))
    .addSubcommand(s => s
      .setName('panel_description')
      .setDescription('Modifier la description du panel')
      .addStringOption(o => o.setName('description').setDescription('Nouvelle description').setRequired(true))),

  // /add — ajouter un membre au ticket
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('➕ Ajouter un membre au ticket')
    .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(false)),

  // /delet — retirer un membre du ticket
  new SlashCommandBuilder()
    .setName('delet')
    .setDescription('➖ Retirer un membre du ticket')
    .addUserOption(o => o.setName('utilisateur').setDescription('Utilisateur').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(false)),

  // /close — fermer le ticket avec compte à rebours
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('🔒 Fermer le ticket (compte à rebours 5 → 0)'),
];

async function registerCmds(guildId) {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: CMDS.map(c => c.toJSON()),
    });
    console.log(`✅  Commandes slash enregistrées → serveur ${guildId}`);
  } catch (e) {
    console.error('registerCmds error:', e.message);
  }
}

// ================================================================
//  UTILITAIRES
// ================================================================

const S2ENUM = {
  Primary:   ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success:   ButtonStyle.Success,
  Danger:    ButtonStyle.Danger,
};

/** Vérifie si l'ID est un owner du bot */
const isOwner = (id, cfg) => cfg.owners.includes(String(id));

/**
 * Peut claim/unclaim : rôle support OU owner du bot
 * (le rôle senior ne peut PAS claim/unclaim, seulement superviser)
 */
const isSupport = (member, cfg) =>
  isOwner(member.id, cfg) ||
  !!(cfg.supportRoleId && member.roles.cache.has(cfg.supportRoleId));

/**
 * Staff complet (add/delet/close) : support + senior + owner
 */
const isStaff = (member, cfg) =>
  isSupport(member, cfg) ||
  !!(cfg.seniorRoleId && member.roles.cache.has(cfg.seniorRoleId));

// ================================================================
//  PANEL
// ================================================================

async function sendPanel(channel, cfg) {
  const embed = new EmbedBuilder()
    .setTitle(cfg.panelTitle)
    .setDescription(cfg.panelDescription)
    .setColor(0x7B2FBE)                      // ◀ rebord gauche violet
    .setFooter({ text: 'malédiké • Support' })
    .setTimestamp();

  // Max 5 lignes de 5 boutons = 25 boutons
  const rows = [];
  for (let i = 0; i < cfg.categories.length && rows.length < 5; i += 5) {
    const row = new ActionRowBuilder();
    cfg.categories.slice(i, i + 5).forEach(cat => {
      const b = new ButtonBuilder()
        .setCustomId(`t_open_${cat.id}`)
        .setLabel(cat.label)
        .setStyle(S2ENUM[cat.style] ?? ButtonStyle.Primary);
      if (cat.emoji) b.setEmoji(cat.emoji);
      row.addComponents(b);
    });
    rows.push(row);
  }

  // Si aucune catégorie, bouton par défaut
  if (!rows.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('t_open_default')
        .setLabel('Ouvrir un ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫'),
    ));
  }

  return channel.send({ embeds: [embed], components: rows });
}

// ================================================================
//  EMBED & ROW DU TICKET
// ================================================================

function mkEmbed(data, user, cat) {
  return new EmbedBuilder()
    .setTitle(`🎫 Ticket créé  #${data.ticketNumber}`)
    .setDescription(
      `> 👤 **Utilisateur :** <@${data.userId}>\n` +
      `> 📂 **Catégorie :** ${cat?.emoji ?? '🎫'} ${cat?.label ?? data.category}\n` +
      `> 📝 **Raison :** ${data.reason || 'Aucune raison fournie'}\n` +
      `> 📊 **Statut :** ${
        data.claimed
          ? `🟢 Réclamé par <@${data.claimedBy}>`
          : '🔴 Non réclamé'
      }`,
    )
    .setColor(0x7B2FBE)                      // ◀ rebord gauche violet
    .setThumbnail(user?.displayAvatarURL() ?? null)
    .setFooter({ text: `malédiké • Ticket #${data.ticketNumber}` })
    .setTimestamp(data.createdAt);
}

function mkRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('t_claim')
      .setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId('t_unclaim')
      .setLabel('Unclaim').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    new ButtonBuilder().setCustomId('t_close')
      .setLabel('Fermer').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
  );
}

/** Retrouve et met à jour l'embed principal du ticket */
async function refreshEmbed(channel, cfg) {
  const data = cfg.openTickets[channel.id];
  if (!data) return;
  const cat  = cfg.categories.find(c => c.id === data.category) ?? { label: data.category, emoji: '🎫' };
  let user = null;
  try { user = await client.users.fetch(data.userId); } catch { /* noop */ }

  const msgs   = await channel.messages.fetch({ limit: 20 });
  const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
  if (botMsg) await botMsg.edit({ embeds: [mkEmbed(data, user, cat)], components: [mkRow()] }).catch(() => {});
}

// ================================================================
//  CRÉATION DU TICKET
// ================================================================

async function createTicket(guild, user, cfg, categoryId, reason) {
  cfg.ticketCounter = (cfg.ticketCounter || 0) + 1;
  const num = String(cfg.ticketCounter).padStart(4, '0');
  const cat = cfg.categories.find(c => c.id === categoryId) ?? { label: categoryId, emoji: '🎫' };

  // Permissions du salon privé
  const perms = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  if (cfg.supportRoleId) perms.push({
    id: cfg.supportRoleId,
    allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ManageMessages,
    ],
  });

  if (cfg.seniorRoleId) perms.push({
    id: cfg.seniorRoleId,
    allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ManageMessages,
    ],
  });

  const channel = await guild.channels.create({
    name: `ticket-${num}`,
    type: ChannelType.GuildText,
    ...(cfg.ticketCategoryId ? { parent: cfg.ticketCategoryId } : {}),
    permissionOverwrites: perms,
  });

  const ticketData = {
    userId:       user.id,
    category:     categoryId,
    reason,
    claimed:      false,
    claimedBy:    null,
    ticketNumber: num,
    createdAt:    Date.now(),
  };
  cfg.openTickets[channel.id] = ticketData;
  saveCfg(cfg);

  // Ping : créateur + rôle support
  let ping = `<@${user.id}>`;
  if (cfg.supportRoleId) ping += ` <@&${cfg.supportRoleId}>`;

  await channel.send({ content: ping, embeds: [mkEmbed(ticketData, user, cat)], components: [mkRow()] });
  return channel;
}

// ================================================================
//  FERMETURE AVEC COMPTE À REBOURS 5 → 0
// ================================================================

function mkCdEmbed(n) {
  return new EmbedBuilder()
    .setTitle('🔒 Fermeture du ticket')
    .setDescription(
      n > 0
        ? `Ce ticket sera fermé dans **${n}** seconde${n > 1 ? 's' : ''}...`
        : '**🔴 Fermeture en cours...**',
    )
    .setColor(0xFF4444);
}

async function closeTicket(channel, cfg, interaction) {
  let msg;

  if (interaction) {
    // Réponse initiale à l'interaction (affiche 5)
    msg = await interaction.reply({ embeds: [mkCdEmbed(5)], fetchReply: true }).catch(() => null);
  } else {
    msg = await channel.send({ embeds: [mkCdEmbed(5)] }).catch(() => null);
  }

  let count = 4;
  const iv = setInterval(async () => {
    if (count > 0) {
      // Mettre à jour le message avec le nouveau chiffre
      await msg?.edit({ embeds: [mkCdEmbed(count)] }).catch(() => {});
      count--;
    } else {
      clearInterval(iv);
      // Afficher 0 / "Fermeture en cours..."
      await msg?.edit({ embeds: [mkCdEmbed(0)] }).catch(() => {});
      await new Promise(r => setTimeout(r, 900));
      // Supprimer le ticket et le salon
      delete cfg.openTickets[channel.id];
      saveCfg(cfg);
      await channel.delete('Ticket fermé').catch(() => {});
    }
  }, 1000);
}

// ================================================================
//  EVENTS
// ================================================================

client.once('ready', async () => {
  console.log(`🚀  Connecté : ${client.user.tag}`);
  client.user.setActivity('malédiké • Support', { type: 3 }); // Watching
  for (const g of client.guilds.cache.values()) await registerCmds(g.id);
});

client.on('guildCreate', g => registerCmds(g.id));

// ──────────────────────────────────────────────────────────────
//  COMMANDES PRÉFIXÉES  $ownerbot / $removeowner
// ──────────────────────────────────────────────────────────────

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;
  const cfg  = loadCfg();
  const args = msg.content.trim().split(/\s+/);

  // $ownerbot @user ou ID
  if (args[0] === '$ownerbot') {
    if (!isOwner(msg.author.id, cfg))
      return msg.reply('❌ Permission refusée. Tu n\'es pas owner du bot.');

    const targetId = msg.mentions.users.first()?.id ?? args[1];
    if (!targetId || !/^\d+$/.test(targetId))
      return msg.reply('❌ Usage : `$ownerbot @user` ou `$ownerbot 123456789`');

    if (cfg.owners.includes(targetId))
      return msg.reply('⚠️ Cet utilisateur est déjà owner du bot.');

    cfg.owners.push(targetId);
    saveCfg(cfg);
    return msg.reply(`✅ <@${targetId}> est maintenant owner du bot!`);
  }

  // $removeowner @user ou ID
  if (args[0] === '$removeowner') {
    if (!isOwner(msg.author.id, cfg)) return;

    const targetId = msg.mentions.users.first()?.id ?? args[1];
    if (!targetId)
      return msg.reply('❌ Usage : `$removeowner @user` ou `$removeowner ID`');

    if (['685679698054742017', '465620464232955911'].includes(targetId))
      return msg.reply('❌ Impossible de retirer les owners fondateurs.');

    cfg.owners = cfg.owners.filter(id => id !== targetId);
    saveCfg(cfg);
    return msg.reply(`✅ <@${targetId}> retiré des owners du bot.`);
  }

  // $owners — lister les owners
  if (args[0] === '$owners') {
    if (!isOwner(msg.author.id, cfg)) return;
    return msg.reply(`👑 **Owners du bot :**\n${cfg.owners.map(id => `• <@${id}> (\`${id}\`)`).join('\n')}`);
  }
});

// ──────────────────────────────────────────────────────────────
//  INTERACTIONS  (Slash + Boutons + Modals)
// ──────────────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  const cfg = loadCfg();

  // ============================================================
  //  SLASH COMMANDS
  // ============================================================

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    const member = interaction.member;

    // ── /setup ────────────────────────────────────────────────
    if (commandName === 'setup') {
      if (!isOwner(interaction.user.id, cfg))
        return interaction.reply({ content: '❌ Owners uniquement.', ephemeral: true });

      const ch = interaction.options.getChannel('salon');
      await sendPanel(ch, cfg);
      cfg.panelChannelId = ch.id;
      saveCfg(cfg);
      return interaction.reply({ content: `✅ Panel envoyé dans <#${ch.id}>`, ephemeral: true });
    }

    // ── /panel ────────────────────────────────────────────────
    if (commandName === 'panel') {
      if (!isOwner(interaction.user.id, cfg))
        return interaction.reply({ content: '❌ Owners uniquement.', ephemeral: true });

      if (!cfg.panelChannelId)
        return interaction.reply({ content: '❌ Aucun salon configuré. Utilise `/setup` d\'abord.', ephemeral: true });

      const ch = interaction.guild.channels.cache.get(cfg.panelChannelId);
      if (!ch) return interaction.reply({ content: '❌ Salon introuvable.', ephemeral: true });

      await sendPanel(ch, cfg);
      return interaction.reply({ content: `✅ Panel rafraîchi dans <#${ch.id}>`, ephemeral: true });
    }

    // ── /config ───────────────────────────────────────────────
    if (commandName === 'config') {
      if (!isOwner(interaction.user.id, cfg))
        return interaction.reply({ content: '❌ Owners uniquement.', ephemeral: true });

      const sub = interaction.options.getSubcommand();

      if (sub === 'role_support') {
        const role = interaction.options.getRole('role');
        cfg.supportRoleId = role.id;
        saveCfg(cfg);
        return interaction.reply({ content: `✅ Rôle support défini → <@&${role.id}>\nCe rôle sera pingé à chaque ticket et peut claim/unclaim.`, ephemeral: true });
      }

      if (sub === 'role_senior') {
        const role = interaction.options.getRole('role');
        cfg.seniorRoleId = role.id;
        saveCfg(cfg);
        return interaction.reply({ content: `✅ Rôle senior défini → <@&${role.id}>\nCe rôle peut voir/gérer les tickets mais n'est pas pingé.`, ephemeral: true });
      }

      if (sub === 'ticket_category') {
        const cat = interaction.options.getChannel('categorie');
        if (cat.type !== ChannelType.GuildCategory)
          return interaction.reply({ content: '❌ Sélectionne une catégorie Discord (pas un salon texte).', ephemeral: true });
        cfg.ticketCategoryId = cat.id;
        saveCfg(cfg);
        return interaction.reply({ content: `✅ Les tickets seront créés sous la catégorie **${cat.name}**`, ephemeral: true });
      }

      if (sub === 'category_add') {
        if (cfg.categories.length >= 25)
          return interaction.reply({ content: '❌ Maximum 25 catégories (limite Discord : 5 lignes × 5 boutons).', ephemeral: true });

        const id    = interaction.options.getString('id').toLowerCase().replace(/\s+/g, '_');
        const label = interaction.options.getString('label');
        const emoji = interaction.options.getString('emoji') ?? null;
        const style = interaction.options.getString('style') ?? 'Primary';

        if (cfg.categories.find(c => c.id === id))
          return interaction.reply({ content: `❌ L'ID \`${id}\` est déjà utilisé.`, ephemeral: true });

        cfg.categories.push({ id, label, emoji, style });
        saveCfg(cfg);
        return interaction.reply({ content: `✅ Bouton **${emoji ? emoji + ' ' : ''}${label}** ajouté!\nRelance \`/panel\` pour afficher les changements.`, ephemeral: true });
      }

      if (sub === 'category_remove') {
        const id     = interaction.options.getString('id');
        const before = cfg.categories.length;
        cfg.categories = cfg.categories.filter(c => c.id !== id);
        saveCfg(cfg);
        return interaction.reply({
          content: cfg.categories.length < before
            ? `✅ Catégorie \`${id}\` supprimée.`
            : `❌ Aucune catégorie avec l'ID \`${id}\`.`,
          ephemeral: true,
        });
      }

      if (sub === 'category_list') {
        if (!cfg.categories.length)
          return interaction.reply({ content: '📋 Aucune catégorie configurée.', ephemeral: true });

        const list = cfg.categories.map((c, i) =>
          `**${i + 1}.** ${c.emoji ?? '🎫'} \`${c.id}\` → **${c.label}** (${c.style})`
        ).join('\n');
        return interaction.reply({ content: `📋 **Catégories actuelles :**\n${list}`, ephemeral: true });
      }

      if (sub === 'panel_titre') {
        cfg.panelTitle = interaction.options.getString('titre');
        saveCfg(cfg);
        return interaction.reply({ content: '✅ Titre du panel mis à jour.', ephemeral: true });
      }

      if (sub === 'panel_description') {
        cfg.panelDescription = interaction.options.getString('description');
        saveCfg(cfg);
        return interaction.reply({ content: '✅ Description du panel mise à jour.', ephemeral: true });
      }
    }

    // ── /add ──────────────────────────────────────────────────
    if (commandName === 'add') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Utilise `/add` uniquement dans un ticket.', ephemeral: true });

      if (!isStaff(member, cfg))
        return interaction.reply({ content: '❌ Permission refusée. (staff uniquement)', ephemeral: true });

      let target = interaction.options.getUser('utilisateur');
      const rawId = interaction.options.getString('id');
      if (!target && rawId) {
        try { target = await client.users.fetch(rawId); } catch {
          return interaction.reply({ content: '❌ Utilisateur introuvable avec cet ID.', ephemeral: true });
        }
      }
      if (!target)
        return interaction.reply({ content: '❌ Spécifie un utilisateur (@mention) ou un ID.', ephemeral: true });

      await interaction.channel.permissionOverwrites.edit(target.id, {
        ViewChannel:        true,
        SendMessages:       true,
        ReadMessageHistory: true,
        AttachFiles:        true,
      });
      return interaction.reply({ content: `✅ <@${target.id}> a été ajouté au ticket!` });
    }

    // ── /delet ────────────────────────────────────────────────
    if (commandName === 'delet') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Utilise `/delet` uniquement dans un ticket.', ephemeral: true });

      if (!isStaff(member, cfg))
        return interaction.reply({ content: '❌ Permission refusée. (staff uniquement)', ephemeral: true });

      let target = interaction.options.getUser('utilisateur');
      const rawId = interaction.options.getString('id');
      if (!target && rawId) {
        try { target = await client.users.fetch(rawId); } catch {
          return interaction.reply({ content: '❌ Utilisateur introuvable avec cet ID.', ephemeral: true });
        }
      }
      if (!target)
        return interaction.reply({ content: '❌ Spécifie un utilisateur (@mention) ou un ID.', ephemeral: true });

      if (target.id === data.userId)
        return interaction.reply({ content: '❌ Impossible de retirer le créateur du ticket.', ephemeral: true });

      await interaction.channel.permissionOverwrites.edit(target.id, {
        ViewChannel:  false,
        SendMessages: false,
      });
      return interaction.reply({ content: `✅ <@${target.id}> a été retiré du ticket!` });
    }

    // ── /close ────────────────────────────────────────────────
    if (commandName === 'close') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Utilise `/close` uniquement dans un ticket.', ephemeral: true });

      if (!isStaff(member, cfg) && interaction.user.id !== data.userId)
        return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });

      return closeTicket(interaction.channel, cfg, interaction);
    }
  }

  // ============================================================
  //  BOUTONS
  // ============================================================

  if (interaction.isButton()) {
    const { customId } = interaction;
    const member = interaction.member;

    // ── Ouvrir un ticket → affiche le modal ──────────────────
    if (customId.startsWith('t_open_')) {
      const catId = customId.slice(7); // 't_open_'.length === 7

      // Un seul ticket actif par utilisateur
      const existing = Object.entries(cfg.openTickets)
        .find(([, d]) => d.userId === interaction.user.id);
      if (existing)
        return interaction.reply({
          content: `❌ Tu as déjà un ticket ouvert : <#${existing[0]}>`,
          ephemeral: true,
        });

      const cat = cfg.categories.find(c => c.id === catId) ?? { label: 'Support', emoji: '🎫' };

      const modal = new ModalBuilder()
        .setCustomId(`t_modal_${catId}`)
        .setTitle(`${cat.emoji ?? '🎫'} ${cat.label}`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Raison du ticket')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Décris ta demande en détail...')
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
      return interaction.showModal(modal);
    }

    // ── Claim ─────────────────────────────────────────────────
    if (customId === 't_claim') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });

      if (!isSupport(member, cfg))
        return interaction.reply({
          content: '❌ Vous ne pouvez pas claim ce ticket car vous n\'avez pas le rôle requis.',
          ephemeral: true,
        });

      if (data.claimed)
        return interaction.reply({
          content: `❌ Ce ticket est déjà claim par <@${data.claimedBy}>.`,
          ephemeral: true,
        });

      data.claimed   = true;
      data.claimedBy = interaction.user.id;
      saveCfg(cfg);
      await refreshEmbed(interaction.channel, cfg);
      return interaction.reply({ content: `✅ <@${interaction.user.id}> a claim ce ticket!` });
    }

    // ── Unclaim ───────────────────────────────────────────────
    if (customId === 't_unclaim') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });

      if (!isSupport(member, cfg))
        return interaction.reply({
          content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'en êtes pas le propriétaire.',
          ephemeral: true,
        });

      if (!data.claimed)
        return interaction.reply({ content: '❌ Ce ticket n\'est pas claim.', ephemeral: true });

      if (data.claimedBy !== interaction.user.id && !isOwner(interaction.user.id, cfg))
        return interaction.reply({
          content: '❌ Vous ne pouvez pas unclaim ce ticket car vous n\'en êtes pas le propriétaire.',
          ephemeral: true,
        });

      data.claimed   = false;
      data.claimedBy = null;
      saveCfg(cfg);
      await refreshEmbed(interaction.channel, cfg);
      return interaction.reply({ content: `🔓 <@${interaction.user.id}> a unclaim ce ticket!` });
    }

    // ── Fermer (bouton) ───────────────────────────────────────
    if (customId === 't_close') {
      const data = cfg.openTickets[interaction.channelId];
      if (!data) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });

      if (!isStaff(member, cfg) && interaction.user.id !== data.userId)
        return interaction.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', ephemeral: true });

      return closeTicket(interaction.channel, cfg, interaction);
    }
  }

  // ============================================================
  //  MODAL SUBMIT  (création du ticket)
  // ============================================================

  if (interaction.isModalSubmit() && interaction.customId.startsWith('t_modal_')) {
    const catId  = interaction.customId.slice(8); // 't_modal_'.length === 8
    const reason = interaction.fields.getTextInputValue('reason');

    await interaction.deferReply({ ephemeral: true });

    try {
      const ch = await createTicket(interaction.guild, interaction.user, cfg, catId, reason);
      return interaction.editReply({ content: `✅ Ton ticket a été créé : <#${ch.id}>` });
    } catch (e) {
      console.error('createTicket error:', e);
      return interaction.editReply({ content: '❌ Erreur lors de la création du ticket. Réessaie.' });
    }
  }
});

// ================================================================
//  KEEP-ALIVE  (Render — selfping toutes les 30 secondes)
// ================================================================

const app  = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_, res) => res.send('✅ malédiké bot is alive'));
app.listen(PORT, () => console.log(`🌐 Keep-alive → port ${PORT}`));

// Selfping silencieux
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`;
  try {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => res.resume()).on('error', () => {});
  } catch { /* silencieux */ }
}, 30_000);

// ================================================================
//  LOGIN
// ================================================================

client.login(TOKEN).catch(e => {
  console.error('❌  Connexion Discord échouée:', e.message);
  process.exit(1);
});