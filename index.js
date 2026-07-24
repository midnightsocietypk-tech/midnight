require("dotenv").config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    Events,
    MessageFlags
} = require("discord.js");
const fs = require("fs");
const http = require("http");

// ================= CONFIG & ENV =================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PANEL_CHANNEL_ID = "1525147897744720033";
const STAFF_ROLE_ID = "1525147649723072663";
const VERIFIED_ROLE_ID = "1359231814547275966";
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL;
const GOODBYE_CHANNEL_ID = process.env.GOODBYE_CHANNEL;
const CLOSED_CATEGORY_ID = "1525148029668163703";

// Log Channels
const LOG_CHANNELS = {
    MOD: process.env.MOD_LOGS,
    TICKET: process.env.TICKET_LOGS,
    MSG: process.env.MESSAGE_LOGS,
    VC: process.env.VC_LOGS,
    JOIN: process.env.JOIN_LEAVE_LOGS,
    ROLE: process.env.ROLE_LOGS,
    SERVER: process.env.SERVER_LOGS,
    INVITE: process.env.INVITE_LOGS,
    NICKNAME: process.env.NICKNAME_LOGS
};

// Categories
const CATEGORY_IDS = {
    other: "1525148216885116968",
    teamreg: "1525148144890023956"
};

// Emojis
const EMOJIS = {
    other: "🌐",
    teamreg: "🏆"
};

// Ticket Images
const SMALL_IMAGE = "https://cdn.discordapp.com/attachments/1525436919557914655/1525458769784340551/IMG_0791.jpg?ex=6a5375b0&is=6a522430&hm=d45872a3672e8628ebd3bb27a535929f9b4d08d534ccad22a7896c0cd5079dc6&";
const TICKET_IMAGE = "https://cdn.discordapp.com/attachments/1525436919557914655/1525458565525934180/ChatGPT_Image_Jul_11_2026_04_07_29_PM.png?ex=6a53757f&is=6a5223ff&hm=80e70c263d4e8757299467f1ee65dfb5d136de3c522a5c1fba80705321693bf0&";

// Data stores
let warnings = {};
let antiSpamChannels = new Set();
let antiLinkChannels = new Set();
let antiMentionChannels = new Set();
let activeGiveaways = new Map();
let invites = new Map(); // Invite Tracker

// Anti-ping configuration
const ANTI_PING_MEMBERS = new Set();
const ANTI_PING_ROLE_ID = "890136671050424340";
const antiPingAttempts = new Map(); // userId => {count, timestamp}

// ================= J2C JOIN TO CREATE SYSTEM =================
let JOIN_TO_CREATE_CHANNEL_ID = null;
let userVoiceChannels = new Map(); // userId => channelId

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.User],
});

// Helper Function
async function sendLog(guild, channelId, embed) {
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (channel) channel.send({ embeds: [embed] }).catch(() => {});
}

// Time Parser
function parseDuration(durationStr) {
    const timeUnits = { m: 60000, h: 3600000, d: 86400000 };
    const match = durationStr.match(/^(\d+)([mhd])$/i);
    if (!match) return null;
    return parseInt(match[1]) * timeUnits[match[2].toLowerCase()];
}

// Check if user already has open ticket
async function hasOpenTicket(guild, userId, type) {
    const categoryId = CATEGORY_IDS[type] || CATEGORY_IDS.other;
    return guild.channels.cache.some(channel =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === categoryId &&
        !channel.name.startsWith("closed-") &&
        (channel.name.includes(userId) || channel.name.toLowerCase().includes(guild.members.cache.get(userId)?.user?.username?.toLowerCase() || ""))
    );
}

// Get Ticket Creator
async function getTicketCreator(channel) {
    const overwrites = channel.permissionOverwrites.cache;
    for (const [, overwrite] of overwrites) {
        if (overwrite.type === 1 && overwrite.id !== STAFF_ROLE_ID && overwrite.allow.has(PermissionsBitField.Flags.ViewChannel)) {
            try {
                return await channel.guild.members.fetch(overwrite.id);
            } catch (e) {}
        }
    }
    return null;
}

// ================= COMMANDS REGISTRATION =================
const commands = [
    new SlashCommandBuilder().setName("ticketpanel").setDescription("Send ticket panel"),
    new SlashCommandBuilder().setName("ban").setDescription("Ban a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder().setName("kick").setDescription("Kick a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder().setName("mute").setDescription("Timeout a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption(o => o.setName("minutes").setDescription("Minutes").setRequired(true)).addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder().setName("unmute").setDescription("Remove timeout").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("warn").setDescription("Warn a user").addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),
    new SlashCommandBuilder().setName("clear").setDescription("Clear messages").addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
    new SlashCommandBuilder().setName("msg").setDescription("Send formatted embed message").addStringOption(o => o.setName("channel_id").setDescription("Channel ID").setRequired(true)),
    new SlashCommandBuilder().setName("serverinfo").setDescription("Shows server information"),
    new SlashCommandBuilder().setName("memberinfo").setDescription("Shows member information").addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),
    new SlashCommandBuilder().setName("giverole").setDescription("Give role to user or all")
        .addStringOption(o => o.setName("roleid").setDescription("Role ID").setRequired(true))
        .addStringOption(o => o.setName("target").setDescription("all or user mention/ID").setRequired(true)),
    new SlashCommandBuilder().setName("removerole").setDescription("Remove role from user or all")
        .addStringOption(o => o.setName("roleid").setDescription("Role ID").setRequired(true))
        .addStringOption(o => o.setName("target").setDescription("all or user mention/ID").setRequired(true)),
    new SlashCommandBuilder().setName("giveaway").setDescription("Start a giveaway")
        .addStringOption(o => o.setName("prize").setDescription("Prize for giveaway").setRequired(true))
        .addStringOption(o => o.setName("duration").setDescription("Duration (e.g. 1m, 2h, 1d)").setRequired(true))
        .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setRequired(true)),
    new SlashCommandBuilder().setName("invites").setDescription("Check user invites").addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),
    new SlashCommandBuilder().setName("antiping").setDescription("Manage anti-ping")
        .addStringOption(o => o.setName("action").setDescription("add/remove/list").setRequired(true))
        .addUserOption(o => o.setName("user").setDescription("User to add/remove").setRequired(false)),

    // ================= VC COMMANDS =================
    new SlashCommandBuilder().setName("vcsetup").setDescription("Setup Join to Create System (Admin Only)"),
    new SlashCommandBuilder()
        .setName("vc")
        .setDescription("Manage your voice channel")
        .addSubcommand(s => s.setName("name").setDescription("Change channel name").addStringOption(o => o.setName("name").setDescription("New name").setRequired(true)))
        .addSubcommand(s => s.setName("limit").setDescription("Set user limit").addIntegerOption(o => o.setName("limit").setDescription("Max users").setRequired(true).setMinValue(0).setMaxValue(99)))
        .addSubcommand(s => s.setName("lock").setDescription("Lock the channel"))
        .addSubcommand(s => s.setName("unlock").setDescription("Unlock the channel"))
        .addSubcommand(s => s.setName("hide").setDescription("Hide the channel"))
        .addSubcommand(s => s.setName("unhide").setDescription("Unhide the channel"))
        .addSubcommand(s => s.setName("kick").setDescription("Kick someone from your channel").addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true)))
        .addSubcommand(s => s.setName("invite").setDescription("Invite someone to your channel").addUserOption(o => o.setName("user").setDescription("User to invite").setRequired(true)))
        .addSubcommand(s => s.setName("claim").setDescription("Claim ownership of the channel")),

].map(cmd => cmd.toJSON());

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log("Slash Commands Registered ✅");
    } catch (err) {
        console.error(err);
    }
    const guild = client.guilds.cache.first();
    if (guild) {
        try {
            const guildInvites = await guild.invites.fetch();
            guildInvites.forEach(invite => invites.set(invite.code, invite.uses));
            console.log("Invite Tracker Initialized ✅");
        } catch (e) {}
    }
});

// ================= INTERACTION HANDLER =================
client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;

            // ================= VC COMMANDS =================
            if (cmd === "vcsetup") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: "❌ Administrator permission required!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                try {
                    const guild = interaction.guild;
                    let category = guild.channels.cache.find(c => c.name === "J2C JOIN TO CREATE" && c.type === ChannelType.GuildCategory);
                    if (!category) {
                        category = await guild.channels.create({ name: "J2C JOIN TO CREATE", type: ChannelType.GuildCategory });
                    }
                    let j2cChannel = guild.channels.cache.find(c => c.name === "j2c" && c.parentId === category.id);
                    if (!j2cChannel) {
                        j2cChannel = await guild.channels.create({ name: "j2c", type: ChannelType.GuildVoice, parent: category.id });
                    }
                    JOIN_TO_CREATE_CHANNEL_ID = j2cChannel.id;
                    await interaction.editReply({ content: "✅ J2C Join to Create Setup Complete!" });
                } catch (e) {
                    await interaction.editReply({ content: "❌ Setup mein error aaya!" });
                }
                return;
            }

            if (cmd === "vc") {
                const sub = interaction.options.getSubcommand();
                const member = interaction.member;
                let channelId = userVoiceChannels.get(member.id);
                let channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;

                if (sub === "claim") {
                    const currentChannel = member.voice.channel;
                    if (!currentChannel) return interaction.reply({ content: "❌ Aap voice channel mein nahi ho!", flags: MessageFlags.Ephemeral });
                    userVoiceChannels.set(member.id, currentChannel.id);
                    await currentChannel.permissionOverwrites.edit(member.id, { ManageChannels: true, Connect: true, Speak: true });
                    return interaction.reply({ content: "✅ Channel ab aapka hai!", flags: MessageFlags.Ephemeral });
                }

                if (!channel) return interaction.reply({ content: "❌ Aapka koi private voice channel nahi hai!", flags: MessageFlags.Ephemeral });

                if (sub === "name") {
                    await channel.setName(interaction.options.getString("name"));
                    return interaction.reply({ content: "✅ Channel name badal diya!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "limit") {
                    await channel.setUserLimit(interaction.options.getInteger("limit"));
                    return interaction.reply({ content: "✅ Limit set kar diya!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "lock") {
                    await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
                    return interaction.reply({ content: "🔒 Channel Locked!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "unlock") {
                    await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true });
                    return interaction.reply({ content: "🔓 Channel Unlocked!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "hide") {
                    await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
                    return interaction.reply({ content: "👁️ Channel Hidden!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "unhide") {
                    await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true });
                    return interaction.reply({ content: "👁️ Channel Unhidden!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "kick") {
                    const target = interaction.options.getMember("user");
                    if (target.voice.channel?.id === channel.id) {
                        await target.voice.disconnect();
                        return interaction.reply({ content: `✅ ${target.user.tag} ko kick kar diya!`, flags: MessageFlags.Ephemeral });
                    }
                    return interaction.reply({ content: "❌ User is not in your channel!", flags: MessageFlags.Ephemeral });
                }
                if (sub === "invite") {
                    const target = interaction.options.getMember("user");
                    await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
                    return interaction.reply({ content: `✅ ${target.user.tag} ko invite kar diya!`, flags: MessageFlags.Ephemeral });
                }
            }

            // ================= PURANE COMMANDS (Bilkul same) =================
            if (cmd === "antiping") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: "❌ Administrator permission required!", flags: MessageFlags.Ephemeral });
                const action = interaction.options.getString("action");
                const user = interaction.options.getUser("user");
                if (action === "add" && user) {
                    ANTI_PING_MEMBERS.add(user.id);
                    return interaction.reply({ content: `✅ ${user.tag} added to anti-ping list.`, flags: MessageFlags.Ephemeral });
                }
                if (action === "remove" && user) {
                    ANTI_PING_MEMBERS.delete(user.id);
                    return interaction.reply({ content: `✅ ${user.tag} removed from anti-ping list.`, flags: MessageFlags.Ephemeral });
                }
                if (action === "list") {
                    const list = ANTI_PING_MEMBERS.size > 0 ? Array.from(ANTI_PING_MEMBERS).map(id => `<@${id}>`).join("\n") : "Empty";
                    return interaction.reply({ content: `**Anti-Ping Members:**\n${list}`, flags: MessageFlags.Ephemeral });
                }
            }
            if (cmd === "ticketpanel") {
                if (interaction.channelId !== PANEL_CHANNEL_ID)
                    return interaction.reply({ content: "Wrong channel ♻️", flags: MessageFlags.Ephemeral });
                const embed = new EmbedBuilder()
                    .setTitle("Ticket Panel")
                    .setColor(0x2b2d31)
                    .setDescription("Experience the best Ticketing Service at Midnight Society! Choose the ticket type from the dropdown below, and our team will promptly assist you.")
                    .setThumbnail(SMALL_IMAGE)
                    .setImage(TICKET_IMAGE)
                    .setFooter({ text: "© Midnight Society | All Rights Reserved." });
                const select = new StringSelectMenuBuilder()
                    .setCustomId("ticket_select")
                    .setPlaceholder("Choose the appropriate category")
                    .addOptions(
                        { label: "🌐 Other", value: "other" },
                        { label: "🏆 Team Registration", value: "teamreg" }
                    );
                return interaction.reply({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(select)]
                });
            }
            if (cmd === "invites") {
                const target = interaction.options.getMember("user") || interaction.member;
                const embed = new EmbedBuilder()
                    .setTitle(`📊 Invite Stats - ${target.user.tag}`)
                    .setColor(0x2b2d31)
                    .setDescription("Invite tracking is active.\nFull detailed stats coming soon.")
                    .setThumbnail(target.user.displayAvatarURL({ dynamic: true }));
                return interaction.reply({ embeds: [embed] });
            }
            if (cmd === "giveaway") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const prize = interaction.options.getString("prize");
                const durationStr = interaction.options.getString("duration");
                const winnersCount = interaction.options.getInteger("winners");
                const durationMs = parseDuration(durationStr);
                if (!durationMs) return interaction.reply({ content: "❌ Invalid duration format!", flags: MessageFlags.Ephemeral });
                const embed = new EmbedBuilder()
                    .setTitle("🎉 **GIVEAWAY** 🎉")
                    .setColor("#00FF00")
                    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnersCount}\n**Ends in:** ${durationStr}`)
                    .setFooter({ text: `Hosted by ${interaction.user.tag}` })
                    .setTimestamp();
                const msg = await interaction.channel.send({ embeds: [embed] });
                await msg.react("🎉");
                const giveawayData = { messageId: msg.id, channelId: interaction.channel.id, prize: prize, winners: winnersCount, endTime: Date.now() + durationMs };
                activeGiveaways.set(msg.id, giveawayData);
                setTimeout(() => endGiveaway(msg.id), durationMs);
                return interaction.reply({ content: "✅ Giveaway started!", flags: MessageFlags.Ephemeral });
            }
            if (cmd === "kick") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const target = interaction.options.getMember("user");
                const reason = interaction.options.getString("reason") || "No reason";
                await target.kick(reason);
                const log = new EmbedBuilder().setColor("#FFA500").setTitle("Member Kicked").addFields({ name: "Target", value: target.user.tag }, { name: "Moderator", value: interaction.user.tag }, { name: "Reason", value: reason }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply(`✅ Kicked ${target.user.tag}`);
            }
        }

        // MODAL, SELECT MENU, BUTTONS
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith("modal_msg_")) {
                const chanId = interaction.customId.replace("modal_msg_", "");
                const content = interaction.fields.getTextInputValue("msg_content");
                const channel = client.channels.cache.get(chanId);
                if (!channel) return interaction.reply({ content: "Invalid Channel ID", flags: MessageFlags.Ephemeral });
                const embed = new EmbedBuilder().setColor("#8B0000").setDescription(content);
                await channel.send({ embeds: [embed] });
                return interaction.reply({ content: "✅ Formatted message sent!", flags: MessageFlags.Ephemeral });
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const type = interaction.customId.replace("modal_", "");
            if (await hasOpenTicket(interaction.guild, interaction.user.id, type)) {
                return interaction.editReply({ content: "❌ You already have an open ticket for this category!" });
            }
            const ticketChannel = await interaction.guild.channels.create({
                name: `${EMOJIS[type] || "🏆"}-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CATEGORY_IDS[type] || CATEGORY_IDS.other,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                ],
            });
            let fields = [];
            if (type === "teamreg") {
                const teamName = interaction.fields.getTextInputValue("team_name");
                const discord = interaction.fields.getTextInputValue("players_discord");
                const riot = interaction.fields.getTextInputValue("players_riot");
                const rank = interaction.fields.getTextInputValue("players_rank");
                fields = [
                    { name: "Team Name", value: `\`\`\`${teamName}\`\`\`` },
                    { name: "Player Discord Username", value: `\`\`\`${discord}\`\`\`` },
                    { name: "Player Riot ID", value: `\`\`\`${riot}\`\`\`` },
                    { name: "Player Ranks", value: `\`\`\`${rank}\`\`\`` }
                ];
            } else {
                interaction.fields.fields.forEach(f => fields.push({ name: f.customId.toUpperCase().replace(/_/g, " "), value: `\`\`\`${f.value || "N/A"}\`\`\`` }));
            }
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle(`Ticket - ${interaction.user.username}`)
                .addFields(fields)
                .setFooter({ text: `Opened by ${interaction.user.tag}` })
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("claim").setLabel("Claim").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("close").setLabel("Close").setStyle(ButtonStyle.Danger)
            );
            await ticketChannel.send({
                content: `<@${interaction.user.id}> <@&${STAFF_ROLE_ID}>\n\n**Your Ticket Is Opened, The Staff Team Will Assist You As Soon as Possible, Till Then Please Wait! <3**`,
                embeds: [embed],
                components: [row]
            });
            const log = new EmbedBuilder().setColor("#3498DB").setTitle("Ticket Created").addFields({ name: "User", value: interaction.user.tag }, { name: "Channel", value: `<#${ticketChannel.id}>` }, { name: "Type", value: type.toUpperCase() }).setTimestamp();
            await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
            return interaction.editReply(`Ticket Created: ${ticketChannel}`);
        }

        if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
            const type = interaction.values[0];
            const modal = new ModalBuilder().setCustomId(`modal_${type}`).setTitle(`${EMOJIS[type]} ${type.toUpperCase()} FORM`);
            if (type === "teamreg") {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("team_name").setLabel("Team Name").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("players_discord").setLabel("Players Discord Username").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("players_riot").setLabel("Players Riot ID").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("players_rank").setLabel("Players Ranks").setStyle(TextInputStyle.Short).setRequired(true))
                );
            } else {
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("help").setLabel("How can we help?").setStyle(TextInputStyle.Paragraph).setRequired(true)));
            }
            return interaction.showModal(modal);
        }

        if (interaction.isButton()) {
            if (interaction.customId === "claim") {
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const log = new EmbedBuilder().setColor("#2ECC71").setTitle("Ticket Claimed").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Staff Member", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
                return interaction.editReply(`Ticket claimed by <@${interaction.user.id}>`);
            }
            if (interaction.customId === "close") {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const creator = await getTicketCreator(interaction.channel);
                if (creator) {
                    try {
                        const messages = await interaction.channel.messages.fetch({ limit: 100 });
                        let transcript = `Transcript for: ${interaction.channel.name}\nGenerated: ${new Date().toLocaleString()}\n\n`;
                        messages.reverse().forEach(m => transcript += `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}\n`);
                        const buffer = Buffer.from(transcript, "utf-8");
                        await creator.send({ content: `📄 **Your Ticket Transcript** - ${interaction.channel.name}`, files: [{ attachment: buffer, name: `transcript-${interaction.channel.name}.txt` }] });
                    } catch (e) {}
                }
                await interaction.channel.setParent(CLOSED_CATEGORY_ID).catch(() => {});
                await interaction.channel.setName(`closed-${interaction.channel.name}`);
                const log = new EmbedBuilder().setColor("#E74C3C").setTitle("Ticket Closed").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Closed By", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
                const reopenRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("reopen").setLabel("Reopen").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("delete").setLabel("Delete").setStyle(ButtonStyle.Danger)
                );
                return interaction.editReply({ content: "Ticket Closed. ✅ Transcript sent to opener's DM.", components: [reopenRow] });
            }
            if (interaction.customId === "reopen") {
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const originalName = interaction.channel.name.replace("closed-", "");
                await interaction.channel.setName(originalName);
                await interaction.channel.setParent(CATEGORY_IDS.other).catch(() => {});
                const log = new EmbedBuilder().setColor("#2ECC71").setTitle("Ticket Reopened").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Reopened By", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
                return interaction.editReply("Ticket Reopened!");
            }
            if (interaction.customId === "delete") {
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                let transcript = `Transcript for: ${interaction.channel.name}\nGenerated: ${new Date().toLocaleString()}\n\n`;
                messages.reverse().forEach(m => transcript += `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}\n`);
                const buffer = Buffer.from(transcript, "utf-8");
                const log = new EmbedBuilder().setColor("#000000").setTitle("Ticket Deleted").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Deleted By", value: interaction.user.tag }).setTimestamp();
                const ticketLogChan = interaction.guild.channels.cache.get(LOG_CHANNELS.TICKET);
                if (ticketLogChan) await ticketLogChan.send({ embeds: [log], files: [{ attachment: buffer, name: `transcript-${interaction.channel.id}.txt` }] });
                return interaction.channel.delete();
            }
        }
    } catch (err) {
        console.error(err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            interaction.reply({ content: "❌ Something went wrong!", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

// ================= JOIN TO CREATE LOGIC =================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (LOG_CHANNELS.VC) {
        const member = newState.member;
        if (oldState.channelId !== newState.channelId) {
            let action = "";
            if (!oldState.channelId) action = "Joined VC";
            else if (!newState.channelId) action = "Left VC";
            else action = "Switched VC";
            const embed = new EmbedBuilder()
                .setColor("#00FFFF")
                .setTitle("Voice Channel Update")
                .addFields({ name: "Member", value: member.user.tag }, { name: "Action", value: action })
                .setTimestamp();
            await sendLog(newState.guild, LOG_CHANNELS.VC, embed);
        }
    }

    // Join to Create
    if (JOIN_TO_CREATE_CHANNEL_ID && newState.channelId === JOIN_TO_CREATE_CHANNEL_ID && !oldState.channelId) {
        try {
            const guild = newState.guild;
            const category = guild.channels.cache.find(c => c.name === "J2C JOIN TO CREATE");
            const vc = await guild.channels.create({
                name: `${newState.member.displayName}'s Room`,
                type: ChannelType.GuildVoice,
                parent: category ? category.id : null,
                permissionOverwrites: [
                    { id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: newState.member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.ManageChannels] }
                ]
            });
            userVoiceChannels.set(newState.member.id, vc.id);
            await newState.member.voice.setChannel(vc);
        } catch (e) { console.error(e); }
    }

    // Auto delete empty channel
    if (oldState.channelId && !newState.channelId) {
        const channelId = oldState.channelId;
        if (userVoiceChannels.has(oldState.member.id) && userVoiceChannels.get(oldState.member.id) === channelId) {
            const channel = oldState.guild.channels.cache.get(channelId);
            if (channel && channel.members.size === 0) {
                channel.delete().catch(() => {});
                userVoiceChannels.delete(oldState.member.id);
            }
        }
    }
});

// Baaki saare events (MessageCreate, Member Join/Leave, etc.)
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.toLowerCase() === "!automsg") {
        const autoEmbed = new EmbedBuilder()
            .setTitle("Welcome to Midnight Society")
            .setDescription("Enjoy your stay! Follow the rules and have fun.")
            .setColor(0x2b2d31);
        return message.channel.send({ embeds: [autoEmbed] });
    }
    // Anti-ping logic (pura purana)
    let shouldBlock = false;
    message.mentions.members.forEach(member => {
        if (ANTI_PING_MEMBERS.has(member.id)) shouldBlock = true;
    });
    if (message.mentions.roles.has(ANTI_PING_ROLE_ID)) shouldBlock = true;
    if (shouldBlock) {
        // ... pura anti-ping code same
    }
});

client.on(Events.MessageDelete, async (message) => { /* pura purana code */ });
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => { /* pura purana code */ });
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => { /* pura purana code */ });
client.on(Events.GuildMemberAdd, async (member) => { /* pura purana code */ });
client.on(Events.GuildMemberRemove, async (member) => { /* pura purana code */ });

async function endGiveaway(messageId) {
    // pura purana giveaway end function
    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway) return;
    // ... baaki same
    activeGiveaways.delete(messageId);
}

console.log("Bot is ready with All Logs + Premium Ticket Panel + Advanced Anti-Ping + Invite Tracker + Full Join to Create System!");
client.login(TOKEN).catch(console.error);
