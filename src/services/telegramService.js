const TelegramBot = require("node-telegram-bot-api");
const { logger } = require('../utils/logger');
const { TOKEN, OWNER_ID } = require('../config/telegram');
const { loadDatabase, saveDatabase } = require('./databaseService');
const { disconnectAllActiveConnections, startUserSessions } = require('./whatsappService');

const bot = new TelegramBot(TOKEN, { polling: true });

// Command handlers
bot.onText(/^\/?(start|menu)/, (msg) => {
  const id = msg.from.id;
  const isOwner = id === OWNER_ID;
  const isUser = true; // Simplified for this example

  if (!isUser) return bot.sendMessage(id, "❌ Kamu tidak memiliki izin untuk menggunakan perintah ini.");

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🆕 Buat Akun Member", callback_data: "create_member" }],
        [{ text: "⏳ Set Expired", callback_data: "set_expire" }],
        ...(isOwner ? [[
          { text: "📋 List User", callback_data: "list_user" },
          { text: "🎛 Buat Custom User", callback_data: "create_custom" },
          { text: "🗑 Hapus User", callback_data: "delete_user" }
        ]] : [])
      ]
    }
  };

  bot.sendMessage(id, `👋 Halo ${msg.from.first_name}, pilih menu:`, options);
});

// Handle callback queries
bot.on("callback_query", async (query) => {
  const id = query.from.id;
  const data = query.data;
  const isOwner = id === OWNER_ID;
  const isUser = true; // Simplified for this example

  if (!isUser) return bot.answerCallbackQuery(query.id, { text: "Tidak diizinkan." });

  switch (data) {
    case "create_member":
      bot.sendMessage(id, "Masukkan data: `username|password|durasi_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, password, day] = msg.text.split("|");
        const db = loadDatabase();
        if (db.find(u => u.username === username)) return bot.sendMessage(id, "❌ Username sudah ada!");
        const expired = new Date();
        expired.setDate(expired.getDate() + parseInt(day));
        db.push({ username, password, role: "member", expiredDate: expired.toISOString().split("T")[0] });
        saveDatabase(db);
        bot.sendMessage(id, `✅ Akun member dibuat:
👤 Username: ${username}
🔐 Password: ${password}`);
      });
      break;

    case "set_expire":
      bot.sendMessage(id, "Masukkan: `username|tambah_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, addDays] = msg.text.split("|");
        const db = loadDatabase();
        const user = db.find(u => u.username === username);
        if (!user) return bot.sendMessage(id, "❌ User tidak ditemukan.");

        const current = new Date(user.expiredDate);
        current.setDate(current.getDate() + parseInt(addDays));
        user.expiredDate = current.toISOString().split("T")[0];
        saveDatabase(db);
        bot.sendMessage(id, `✅ Masa aktif diperbarui untuk ${username} ke ${user.expiredDate}`);
      });
      break;

    case "list_user":
      if (!isOwner) return;
      const users = getFormattedUsers();
      bot.sendMessage(id, `📋 *Daftar Pengguna:*
 ${users}`, { parse_mode: "Markdown" });
      break;

    case "create_custom":
      if (!isOwner) return;
      bot.sendMessage(id, "Masukkan: `username|password|role|durasi_hari`", { parse_mode: "Markdown" });
      bot.once("message", msg => {
        const [username, password, role, day] = msg.text.split("|");
        const db = loadDatabase();
        if (db.find(u => u.username === username)) return bot.sendMessage(id, "❌ Username sudah ada!");
        const expired = new Date();
        expired.setDate(expired.getDate() + parseInt(day));
        db.push({ username, password, role, expiredDate: expired.toISOString().split("T")[0] });
        saveDatabase(db);
        bot.sendMessage(id, `✅ Akun ${role} dibuat:
👤 Username: ${username}`);
      });
      break;

    case "delete_user":
      if (!isOwner) return;
      bot.sendMessage(id, "Masukkan username yang akan dihapus:");
      bot.once("message", msg => {
        const db = loadDatabase();
        const index = db.findIndex(u => u.username === msg.text);
        if (index === -1) return bot.sendMessage(id, "❌ User tidak ditemukan.");
        const deleted = db.splice(index, 1)[0];
        saveDatabase(db);
        bot.sendMessage(id, `🗑️ User ${deleted.username} berhasil dihapus.`);
      });
      break;
  }
});

// Helper functions
function getFormattedUsers() {
  const db = loadDatabase();
  return db.map(u => `👤 ${u.username} | 🎯 ${u.role || 'member'} | ⏳ ${u.expiredDate}`).join("\n");
}

// Start the bot
function startTelegramBot() {
  console.log("Telegram bot started");
}

module.exports = {
  bot,
  startTelegramBot
};