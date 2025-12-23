const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

require("dotenv").config();
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");

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

/* ================= ROLE HELPERS ================= */
const isAdmin = (m) => m.roles.cache.some((r) => r.name === "Admin");
const isManager = (m) =>
  m.roles.cache.some((r) => ["Manager", "Admin"].includes(r.name));
const isModerator = (m) =>
  m.roles.cache.some((r) => ["Moderator", "Manager", "Admin"].includes(r.name));

/* ================= READY ================= */
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ================= MEMBER JOIN ================= */
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;
  const unverified = guild.roles.cache.find((r) => r.name === "Unverified");
  const verificationChannel = guild.channels.cache.find(
    (c) => c.name === "verification"
  );
  if (!unverified || !verificationChannel) return;

  await member.roles.add(unverified);

  const thread = await verificationChannel.threads.create({
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
});

/* ================= MESSAGE HANDLER ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  /* -------- HELP -------- */
  if (content === "help") {
    return message.reply(
      "📌 **Help**\n• Verification is automatic\n• Use `restart` if stuck\n• Contact moderators if needed"
    );
  }

  /* -------- PING -------- */
  if (content === "!ping" && isModerator(message.member)) {
    return message.reply("🏓 Bot is online.");
  }

  /* -------- WHOIS (PRIVATE OUTPUT) -------- */
  if (content.startsWith("!whois") && isModerator(message.member)) {
    const target = message.mentions.members.first();
    if (!target) return;

    await message.delete().catch(() => {});
    const modChannel = message.guild.channels.cache.find(
      (c) => c.name === "mod-commands"
    );

    return modChannel?.send(
      `🔍 **WHOIS**\nUser: ${target}\nID: ${target.id}\nNickname: ${
        target.nickname || "None"
      }`
    );
  }

  /* -------- NICKNAME ASSIGN -------- */
  if (content.startsWith("!nick") && isManager(message.member)) {
    await message.delete().catch(() => {});
    const args = content.split(" ");

    // Reset nickname
    if (args[1] === "reset") {
      const target = message.mentions.members.first();
      if (!target) return;
      await target.setNickname(null).catch(() => {});
      message.guild.channels.cache
        .find((c) => c.name === "moderation-logs")
        ?.send(`✏️ NICK RESET\nUser: ${target}\nBy: ${message.author}`);
      return;
    }

    const target = message.mentions.members.first();
    if (!target) return;

    const nickname = args.slice(2).join(" ");
    if (!nickname || nickname.length > 32) return;

    await target.setNickname(nickname).catch(() => {});
    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `✏️ NICK SET\nUser: ${target}\nNew: ${nickname}\nBy: ${message.author}`
      );
    return;
  }

  /* -------- CLEAR -------- */
  if (content.startsWith("!clear") && isModerator(message.member)) {
    await message.delete().catch(() => {});
    const arg = content.split(" ")[1];
    let deleted = 0;

    if (arg === "all") {
      let fetched;
      do {
        fetched = await message.channel.messages.fetch({ limit: 100 });
        const deletable = fetched.filter(
          (m) => Date.now() - m.createdTimestamp < 1209600000
        );
        await message.channel.bulkDelete(deletable, true);
        deleted += deletable.size;
      } while (fetched.size >= 2);
    } else {
      const count = parseInt(arg);
      if (!count || count < 1 || count > 100) return;
      const msgs = await message.channel.messages.fetch({ limit: count + 1 });
      const deletable = msgs.filter(
        (m) => Date.now() - m.createdTimestamp < 1209600000
      );
      await message.channel.bulkDelete(deletable, true);
      deleted = deletable.size;
    }

    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `🧹 CLEAR\nChannel: ${message.channel}\nBy: ${message.author}\nCount: ${deleted}`
      );
    return;
  }

  /* -------- WARN -------- */
  if (content.startsWith("!warn") && isModerator(message.member)) {
    const target = message.mentions.members.first();
    const reason = content.split(" ").slice(2).join(" ") || "No reason";
    if (!target) return;

    await message.delete().catch(() => {});
    await target.send(`⚠️ Warning: ${reason}`).catch(() => {});
    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `⚠️ WARN\nUser: ${target}\nBy: ${message.author}\nReason: ${reason}`
      );
    return;
  }

  /* -------- TIMEOUT -------- */
  if (content.startsWith("!timeout") && isModerator(message.member)) {
    const target = message.mentions.members.first();
    const duration = content.split(" ")[2];
    const reason = content.split(" ").slice(3).join(" ") || "No reason";
    if (!target || !duration) return;

    const ms = duration.endsWith("m")
      ? parseInt(duration) * 60000
      : duration.endsWith("h")
      ? parseInt(duration) * 3600000
      : duration.endsWith("d")
      ? parseInt(duration) * 86400000
      : null;
    if (!ms) return;

    await message.delete().catch(() => {});
    await target.timeout(ms, reason);
    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `⏳ TIMEOUT\nUser: ${target}\nBy: ${message.author}\nDuration: ${duration}\nReason: ${reason}`
      );
    return;
  }

  /* -------- KICK -------- */
  if (content.startsWith("!kick") && isManager(message.member)) {
    const target = message.mentions.members.first();
    const reason = content.split(" ").slice(2).join(" ") || "No reason";
    if (!target) return;

    await message.delete().catch(() => {});
    await target.kick(reason);
    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `👢 KICK\nUser: ${target}\nBy: ${message.author}\nReason: ${reason}`
      );
    return;
  }

  /* -------- BAN -------- */
  if (content.startsWith("!ban") && isModerator(message.member)) {
    const target = message.mentions.members.first();
    const reason = content.split(" ").slice(2).join(" ") || "No reason";
    if (!target) return;

    await message.delete().catch(() => {});
    await target.ban({ reason });
    message.guild.channels.cache
      .find((c) => c.name === "moderation-logs")
      ?.send(
        `🚫 BAN\nUser: ${target}\nBy: ${message.author}\nReason: ${reason}`
      );
    return;
  }

  /* -------- VERIFICATION FLOW -------- */
  if (!message.channel.isThread()) return;
  const state = userState.get(message.author.id);
  if (!state || state.threadId !== message.channel.id) return;

  if (Date.now() - state.startedAt > TIMEOUT_MS) {
    return message.channel.send("⏰ Timed out. Type `restart`.");
  }

  if (content.toLowerCase() === "restart") {
    userState.set(message.author.id, {
      step: "year",
      threadId: state.threadId,
      startedAt: Date.now(),
    });
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
    return message.channel.send("🆔 Enter USN (letters+numbers).");
  }

  if (state.step === "usn") {
    if (!/^[a-zA-Z0-9]+$/.test(content)) {
      return message.channel.send("❌ Invalid USN.");
    }

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
