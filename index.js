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

// Data stores
let warnings = {};
let antiSpamChannels = new Set();
let antiLinkChannels = new Set();
let antiMentionChannels = new Set();
let activeGiveaways = new Map();

// Anti-ping configuration
const ANTI_PING_MEMBERS = new Set();
const ANTI_PING_ROLE_ID = "890136671050424340";

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
});

// ================= INTERACTION HANDLER =================
client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const cmd = interaction.commandName;
            if (cmd === "ticketpanel") {
                if (interaction.channelId !== PANEL_CHANNEL_ID)
                    return interaction.reply({ content: "Wrong channel ♻️", flags: MessageFlags.Ephemeral });
             
                const embed = new EmbedBuilder()
                    .setTitle("MIDNIGHT SOCIETY")
                    .setColor(0x2b2d31)
                    .setDescription("👋 **Welcome to MIDNIGHT SOCIETY Support!**\nPlease select the appropriate ticket category below. 🎫\n\n📌 **Before opening a ticket:**\n• ✅ Make sure your issue has not already been resolved.\n• 🚫 Do not open multiple tickets for the same issue.\n• 📝 Provide clear and complete details.\n• ⏳ Be patient while waiting for support.");
             
                const select = new StringSelectMenuBuilder()
                    .setCustomId("ticket_select")
                    .setPlaceholder("🎟️ Select ticket type")
                    .addOptions(
                        { label: "🌐 Other", value: "other" },
                        { label: "🏆 Team Registration", value: "teamreg" }
                    );
             
                return interaction.reply({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(select)]
                });
            }
            if (cmd === "giveaway") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const prize = interaction.options.getString("prize");
                const durationStr = interaction.options.getString("duration");
                const winnersCount = interaction.options.getInteger("winners");
                const durationMs = parseDuration(durationStr);
                if (!durationMs) {
                    return interaction.reply({ content: "❌ Invalid duration format! Use: 1m, 2h, 1d etc.", flags: MessageFlags.Ephemeral });
                }
                const embed = new EmbedBuilder()
                    .setTitle("🎉 **GIVEAWAY** 🎉")
                    .setColor("#00FF00")
                    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnersCount}\n**Ends in:** ${durationStr}`)
                    .setFooter({ text: `Hosted by ${interaction.user.tag}` })
                    .setTimestamp();
                const msg = await interaction.channel.send({ embeds: [embed] });
                await msg.react("🎉");
                const giveawayData = {
                    messageId: msg.id,
                    channelId: interaction.channel.id,
                    prize: prize,
                    winners: winnersCount,
                    endTime: Date.now() + durationMs,
                };
                activeGiveaways.set(msg.id, giveawayData);
                setTimeout(() => endGiveaway(msg.id), durationMs);
                return interaction.reply({ content: "✅ Giveaway started!", flags: MessageFlags.Ephemeral });
            }
            if (cmd === "giverole") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const roleId = interaction.options.getString("roleid");
                const target = interaction.options.getString("target");
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) return interaction.reply({ content: "❌ Invalid Role ID!", flags: MessageFlags.Ephemeral });
                if (target.toLowerCase() === "all") {
                    const members = await interaction.guild.members.fetch();
                    let count = 0;
                    for (const member of members.values()) {
                        if (!member.roles.cache.has(role.id)) {
                            await member.roles.add(role).catch(() => {});
                            count++;
                        }
                    }
                    return interaction.reply(`✅ Added role to **${count}** members.`);
                } else {
                    const member = interaction.options.getMember("target") || await interaction.guild.members.fetch(target).catch(() => null);
                    if (!member) return interaction.reply({ content: "❌ User not found!", flags: MessageFlags.Ephemeral });
                    await member.roles.add(role);
                    return interaction.reply(`✅ Role given to ${member.user.tag}`);
                }
            }
            if (cmd === "removerole") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const roleId = interaction.options.getString("roleid");
                const target = interaction.options.getString("target");
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) return interaction.reply({ content: "❌ Invalid Role ID!", flags: MessageFlags.Ephemeral });
                if (target.toLowerCase() === "all") {
                    const members = await interaction.guild.members.fetch();
                    let count = 0;
                    for (const member of members.values()) {
                        if (member.roles.cache.has(role.id)) {
                            await member.roles.remove(role).catch(() => {});
                            count++;
                        }
                    }
                    return interaction.reply(`✅ Removed role from **${count}** members.`);
                } else {
                    const member = interaction.options.getMember("target") || await interaction.guild.members.fetch(target).catch(() => null);
                    if (!member) return interaction.reply({ content: "❌ User not found!", flags: MessageFlags.Ephemeral });
                    await member.roles.remove(role);
                    return interaction.reply(`✅ Role removed from ${member.user.tag}`);
                }
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
            if (cmd === "ban") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const target = interaction.options.getMember("user");
                const reason = interaction.options.getString("reason") || "No reason";
                await target.ban({ reason });
                const log = new EmbedBuilder().setColor("#FF0000").setTitle("Member Banned").addFields({ name: "Target", value: target.user.tag }, { name: "Moderator", value: interaction.user.tag }, { name: "Reason", value: reason }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply(`✅ Banned ${target.user.tag}`);
            }
            if (cmd === "mute") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const target = interaction.options.getMember("user");
                const mins = interaction.options.getInteger("minutes");
                const reason = interaction.options.getString("reason") || "No reason";
                await target.timeout(mins * 60000, reason);
                const log = new EmbedBuilder().setColor("#E67E22").setTitle("Member Muted (Timeout)").addFields({ name: "Target", value: target.user.tag }, { name: "Duration", value: `${mins} mins` }, { name: "Moderator", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply(`✅ Muted ${target.user.tag} for ${mins}m`);
            }
            if (cmd === "unmute") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const target = interaction.options.getMember("user");
                await target.timeout(null);
                const log = new EmbedBuilder().setColor("#2ECC71").setTitle("Member Unmuted").addFields({ name: "Target", value: target.user.tag }, { name: "Moderator", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply(`✅ Unmuted ${target.user.tag}`);
            }
            if (cmd === "warn") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const target = interaction.options.getMember("user");
                const key = `${interaction.guild.id}-${target.id}`;
                if (!warnings[key]) warnings[key] = [];
                warnings[key].push(Date.now());
                const log = new EmbedBuilder().setColor("#F1C40F").setTitle("Warning Issued").addFields({ name: "Target", value: target.user.tag }, { name: "Moderator", value: interaction.user.tag }, { name: "Total Warns", value: `${warnings[key].length}` }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply(`⚠️ Warned ${target.user.tag}. Total warnings: ${warnings[key].length}`);
            }
            if (cmd === "clear") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const amount = interaction.options.getInteger("amount");
                await interaction.channel.bulkDelete(amount, true);
                const log = new EmbedBuilder().setColor("#34495E").setTitle("Messages Cleared").addFields({ name: "Channel", value: `<#${interaction.channel.id}>` }, { name: "Amount", value: `${amount}` }, { name: "Moderator", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.MOD, log);
                return interaction.reply({ content: `✅ Deleted ${amount} messages`, flags: MessageFlags.Ephemeral });
            }
            if (cmd === "msg") {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                const chanId = interaction.options.getString("channel_id");
                const modal = new ModalBuilder().setCustomId(`modal_msg_${chanId}`).setTitle("Send Formatted Embed");
                const input = new TextInputBuilder().setCustomId("msg_content").setLabel("Message Content").setStyle(TextInputStyle.Paragraph).setPlaceholder("Yahan apna formatted text paste karein...").setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return interaction.showModal(modal);
            }
            if (cmd === "serverinfo") {
                const guild = interaction.guild;
                const embed = new EmbedBuilder()
                    .setTitle("🛡️ Midnight Society Server Info")
                    .setColor(0x2b2d31)
                    .addFields(
                        { name: "Server Name", value: guild.name },
                        { name: "Members", value: `${guild.memberCount}` },
                        { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp/1000)}:R>` },
                        { name: "Boosts", value: `${guild.premiumSubscriptionCount || 0}` }
                    )
                    .setThumbnail(guild.iconURL({ dynamic: true }));
                return interaction.reply({ embeds: [embed] });
            }
            if (cmd === "memberinfo") {
                const member = interaction.options.getMember("user") || interaction.member;
                const embed = new EmbedBuilder()
                    .setTitle(`Member Info - ${member.user.tag}`)
                    .setColor(0x2b2d31)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                    .addFields(
                        { name: "Joined Server", value: `<t:${Math.floor(member.joinedTimestamp/1000)}:R>`, inline: true },
                        { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp/1000)}:R>`, inline: true },
                        { name: "Roles", value: member.roles.cache.size > 1 ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(" ") : "None" }
                    );
                if (member.user.banner) {
                    embed.setImage(member.user.bannerURL({ dynamic: true, size: 1024 }));
                }
                return interaction.reply({ embeds: [embed] });
            }
            if (["antispam", "antilink", "antimention"].includes(cmd)) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
                    return interaction.reply({ content: "No Permission!", flags: MessageFlags.Ephemeral });
                let status;
                if (cmd === "antispam") antiSpamChannels.has(interaction.channel.id) ? (antiSpamChannels.delete(interaction.channel.id), status = "disabled") : (antiSpamChannels.add(interaction.channel.id), status = "enabled");
                if (cmd === "antilink") antiLinkChannels.has(interaction.channel.id) ? (antiLinkChannels.delete(interaction.channel.id), status = "disabled") : (antiLinkChannels.add(interaction.channel.id), status = "enabled");
                if (cmd === "antimention") antiMentionChannels.has(interaction.channel.id) ? (antiMentionChannels.delete(interaction.channel.id), status = "disabled") : (antiMentionChannels.add(interaction.channel.id), status = "enabled");
                return interaction.reply({ content: `✅ ${cmd} is now **${status}**`, flags: MessageFlags.Ephemeral });
            }
        }

        // MODAL, SELECT MENU, BUTTONS (same as before)
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
                interaction.fields.fields.forEach(f => {
                    fields.push({ name: f.customId.toUpperCase().replace(/_/g, " "), value: `\`\`\`${f.value || "N/A"}\`\`\`` });
                });
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
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
                    return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
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
                        messages.reverse().forEach(m => {
                            transcript += `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}\n`;
                        });
                        const buffer = Buffer.from(transcript, "utf-8");
                        await creator.send({
                            content: `📄 **Your Ticket Transcript** - ${interaction.channel.name}`,
                            files: [{ attachment: buffer, name: `transcript-${interaction.channel.name}.txt` }]
                        });
                    } catch (e) {
                        console.log("Could not send DM to ticket creator");
                    }
                }
                await interaction.channel.setParent(CLOSED_CATEGORY_ID).catch(() => {});
                await interaction.channel.setName(`closed-${interaction.channel.name}`);
                const log = new EmbedBuilder().setColor("#E74C3C").setTitle("Ticket Closed").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Closed By", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
                const reopenRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("reopen").setLabel("Reopen").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId("delete").setLabel("Delete").setStyle(ButtonStyle.Danger)
                );
                return interaction.editReply({
                    content: "Ticket Closed. ✅ Transcript sent to opener's DM.",
                    components: [reopenRow]
                });
            }
            if (interaction.customId === "reopen") {
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
                    return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const originalName = interaction.channel.name.replace("closed-", "");
                await interaction.channel.setName(originalName);
                await interaction.channel.setParent(CATEGORY_IDS.other).catch(() => {});
                const log = new EmbedBuilder().setColor("#2ECC71").setTitle("Ticket Reopened").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Reopened By", value: interaction.user.tag }).setTimestamp();
                await sendLog(interaction.guild, LOG_CHANNELS.TICKET, log);
                return interaction.editReply("Ticket Reopened!");
            }
            if (interaction.customId === "delete") {
                if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
                    return interaction.reply({ content: "Staff Only!", flags: MessageFlags.Ephemeral });
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                let transcript = `Transcript for: ${interaction.channel.name}\nGenerated: ${new Date().toLocaleString()}\n\n`;
                messages.reverse().forEach(m => {
                    transcript += `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content}\n`;
                });
                const buffer = Buffer.from(transcript, "utf-8");
                const log = new EmbedBuilder().setColor("#000000").setTitle("Ticket Deleted").addFields({ name: "Channel", value: interaction.channel.name }, { name: "Deleted By", value: interaction.user.tag }).setTimestamp();
                const ticketLogChan = interaction.guild.channels.cache.get(LOG_CHANNELS.TICKET);
                if (ticketLogChan) {
                    await ticketLogChan.send({
                        embeds: [log],
                        files: [{ attachment: buffer, name: `transcript-${interaction.channel.id}.txt` }]
                    });
                }
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

// Giveaway End Function
async function endGiveaway(messageId) {
    const giveaway = activeGiveaways.get(messageId);
    if (!giveaway) return;
    const channel = client.channels.cache.get(giveaway.channelId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(messageId);
        const reactions = msg.reactions.cache.get("🎉");
        if (!reactions) return;
        const users = await reactions.users.fetch();
        let participants = users.filter(u => !u.bot).map(u => u.id);
        if (participants.length === 0) {
            return channel.send("❌ No one participated in the giveaway.");
        }
        let winners = [];
        for (let i = 0; i < giveaway.winners; i++) {
            if (participants.length === 0) break;
            const winnerId = participants.splice(Math.floor(Math.random() * participants.length), 1)[0];
            winners.push(`<@${winnerId}>`);
        }
        const embed = new EmbedBuilder()
            .setTitle("🎉 Giveaway Ended!")
            .setColor("#FF0000")
            .setDescription(`**Prize:** ${giveaway.prize}\n**Winners:** ${winners.join(", ")}`);
        channel.send({ embeds: [embed] });
    } catch (e) {
        console.log("Giveaway error");
    }
    activeGiveaways.delete(messageId);
}

// ================= AUTO MESSAGE & ANTI-PING =================
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.toLowerCase() === "!automsg") {
        const autoEmbed = new EmbedBuilder()
            .setTitle("Welcome to Midnight Society")
            .setDescription("Enjoy your stay! Follow the rules and have fun.")
            .setColor(0x2b2d31);
        return message.channel.send({ embeds: [autoEmbed] });
    }
    let content = message.content;
    let modified = false;
    message.mentions.members.forEach(member => {
        if (ANTI_PING_MEMBERS.has(member.id)) {
            content = content.replace(new RegExp(`<@!?${member.id}>`, 'g'), "🛡️");
            modified = true;
        }
    });
    if (message.mentions.roles.has(ANTI_PING_ROLE_ID)) {
        content = content.replace(new RegExp(`<@&${ANTI_PING_ROLE_ID}>`, 'g'), "🚫");
        modified = true;
    }
    if (modified) {
        await message.delete().catch(() => {});
        await message.channel.send({ content: `${message.author} ${content}` });
        return;
    }
});


// ================= WELCOME / GOODBYE + AUTO ROLE =================
// ================= WELCOME / GOODBYE + AUTO ROLE =================
client.on(Events.GuildMemberAdd, async (member) => {
    console.log(`[DEBUG] New member joined: ${member.user.tag} (${member.id})`);

    if (VERIFIED_ROLE_ID) {
        await member.roles.add(VERIFIED_ROLE_ID).catch(() => {
            console.log(`[DEBUG] Could not add verified role to ${member.user.tag}`);
        });
    }

    if (WELCOME_CHANNEL_ID) {
        const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
        if (channel) {
            console.log(`[DEBUG] Sending welcome message to channel: ${channel.name}`);
            const embed = new EmbedBuilder()
                .setTitle("Welcome to Midnight Society | 2026!")
                .setColor(0x8B00FF)
                .setDescription(`Hey ${member}, glad you found us!\nWe are happy to welcome you to Midnight Society.`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setImage("https://cdn.discordapp.com/attachments/1525436919557914655/1525446030529794089/ChatGPT_Image_Jul_11_2026_03_17_45_PM.png?ex=6a5369d3&is=6a521853&hm=6c54f6174190b7ed868ff6c83a27a5a56c978c1e92fcc271242e2e2118bc909d&")
                .setFooter({ text: "Midnight Society | 2026" })
                .setTimestamp();
            channel.send({ embeds: [embed] }).then(() => {
                console.log(`[DEBUG] Welcome message sent successfully`);
            }).catch(err => {
                console.log(`[DEBUG] Failed to send welcome message: ${err.message}`);
            });
        } else {
            console.log(`[DEBUG] Welcome channel not found! ID: ${WELCOME_CHANNEL_ID}`);
        }
    } else {
        console.log(`[DEBUG] WELCOME_CHANNEL_ID is not set in .env`);
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    if (GOODBYE_CHANNEL_ID) {
        const channel = member.guild.channels.cache.get(GOODBYE_CHANNEL_ID);
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle("Goodbye")
                .setDescription(`${member.user.tag} left the server.`)
                .setColor("#FF0000");
            channel.send({ embeds: [embed] });
        }
    }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
});

console.log("Bot is ready with Auto Role + Give/Remove Role Commands!");

// ================= BOT LOGIN =================
client.login(TOKEN).catch(console.error);
