require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const express = require("express");

/* ================= EXPRESS KEEP-ALIVE ================= */
const app = express();
app.get("/", (req, res) => res.send("Bot is alive"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server on ${PORT}`));

/* ================= DISCORD CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const userState = new Map();
const TIMEOUT_MS = 5 * 60 * 1000;
const startTime = Date.now();

/* ================= ROLE HELPERS ================= */
const isAdmin = (m) => m.roles.cache.some((r) => r.name === "Admin");
const isManager = (m) =>
  m.roles.cache.some((r) => ["Manager", "Admin"].includes(r.name));
const isModerator = (m) =>
  m.roles.cache.some((r) => ["Moderator", "Manager", "Admin"].includes(r.name));

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await postVerifyButton();
});

/* ================= VERIFY BUTTON ================= */
async function postVerifyButton() {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const channel = guild.channels.cache.find((c) => c.name === "verification");
  if (!channel) return;

  const button = new ButtonBuilder()
    .setCustomId("start_verify")
    .setLabel("Start Verification")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  const messages = await channel.messages.fetch({ limit: 5 });
  if (messages.some((m) => m.author.id === client.user.id)) return;

  await channel.send({
    content:
      "🔐 **Verification Required**\n\n" +
      "Click the button below to begin verification.\n" +
      "If nothing happens, the bot may be restarting.\n" +
      "You can also type **!verify**.",
    components: [row],
  });
}

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "start_verify") {
    await interaction.reply({
      content: "⏳ Verification will begin in **5 seconds**…",
      ephemeral: true,
    });

    setTimeout(() => startVerification(interaction.member), 5000);
  }
});

/* ================= MEMBER JOIN ================= */
client.on("guildMemberAdd", async (member) => {
  const unverified = member.guild.roles.cache.find(
    (r) => r.name === "Unverified"
  );
  if (unverified) await member.roles.add(unverified);
});

/* ================= START VERIFICATION ================= */
async function startVerification(member) {
  if (userState.has(member.id)) return;

  const channel = member.guild.channels.cache.find(
    (c) => c.name === "verification"
  );
  if (!channel) return;

  const thread = await channel.threads.create({
    name: `verify-${member.user.username}`,
    type: ChannelType.PrivateThread,
    autoArchiveDuration: 60,
    invitable: false,
  });

  await thread.members.add(member.id);

  await thread.send(
    `👋 Welcome ${member}\n\n` +
      `Type:\n1 → 1st Year\n2 → 2nd Year\n3 → 3rd Year\n4 → 4th Year\n\n` +
      `Type **restart** anytime.`
  );

  userState.set(member.id, {
    step: "year",
    threadId: thread.id,
    startedAt: Date.now(),
  });
}

/* ================= MESSAGE HANDLER ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  /* ---- !verify fallback ---- */
  if (content === "!verify") {
    await message.delete().catch(() => {});
    return startVerification(message.member);
  }

  /* ---- bot control ---- */
  if (message.channel.name === "bot-control" && isModerator(message.member)) {
    if (content === "!status") {
      const uptime = Math.floor((Date.now() - startTime) / 60000);
      return message.reply(`🟢 Bot online\n⏱️ Uptime: ${uptime} minutes`);
    }
  }

  /* ---- verification flow ---- */
  if (!message.channel.isThread()) return;
  const state = userState.get(message.author.id);
  if (!state || state.threadId !== message.channel.id) return;

  if (Date.now() - state.startedAt > TIMEOUT_MS) {
    return message.channel.send("⏰ Timed out. Type `restart`.");
  }

  if (content.toLowerCase() === "restart") {
    state.step = "year";
    state.startedAt = Date.now();
    return message.channel.send("🔁 Restarted. Type 1–4.");
  }

  await message.delete().catch(() => {});

  if (state.step === "year") {
    const map = { 1: "1st Year", 2: "2nd Year", 3: "3rd Year", 4: "4th Year" };
    if (!map[content]) return message.channel.send("❌ Type 1–4.");
    state.year = map[content];
    state.step = "name";
    return message.channel.send("✍️ Enter REAL NAME.");
  }

  if (state.step === "name") {
    state.name = content;
    state.step = "room";
    return message.channel.send("🏠 Enter ROOM NUMBER.");
  }

  if (state.step === "room") {
    state.room = content;
    state.step = "usn";
    return message.channel.send("🆔 Enter USN (letters + numbers).");
  }

  if (state.step === "usn") {
    if (!/^[a-zA-Z0-9]+$/.test(content))
      return message.channel.send("❌ Invalid USN.");

    state.usn = content;
    const guild = message.guild;
    const member = await guild.members.fetch(message.author.id);

    await member.roles.add([
      guild.roles.cache.find((r) => r.name === state.year),
      guild.roles.cache.find((r) => r.name === "Verified"),
    ]);
    await member.roles.remove(
      guild.roles.cache.find((r) => r.name === "Unverified")
    );

    await member.setNickname(
      `${state.year[0]}Y-${Math.floor(1000 + Math.random() * 9000)}`
    );

    guild.channels.cache
      .find((c) => c.name === "verification-logs")
      ?.send(
        `📝 VERIFIED\nUser: ${member}\nYear: ${state.year}\nName: ${state.name}\nRoom: ${state.room}\nUSN: ${state.usn}`
      );

    await message.channel.send("✅ Verified. Closing thread…");
    userState.delete(member.id);

    setTimeout(async () => {
      await message.channel.setArchived(true);
      setTimeout(() => message.channel.delete().catch(() => {}), 3000);
    }, 3000);
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
