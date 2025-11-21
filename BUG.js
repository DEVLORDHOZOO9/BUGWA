const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeInMemoryStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

// Inisialisasi store
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

// Load store dari file jika ada
if (fs.existsSync('./baileys_store.json')) {
    store.readFromFile('./baileys_store.json')
}

// Simpan store ke file setiap 10 detik
setInterval(() => {
    store.writeToFile('./baileys_store.json')
}, 10_000)

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    const { version } = await fetchLatestBaileysVersion()
    console.log(`using WA v${version.join('.')}`)

    const sock = makeWASocket({
        version,
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' }),
        msgRetryCounterCache: undefined,
        defaultQueryTimeoutMs: undefined,
    })

    store.bind(sock.ev)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            // reconnect if not logged out
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000) // Tunggu 5 detik sebelum reconnect
            }
        }

        if (connection === 'open') {
            console.log('opened connection')
        }
    })

    sock.ev.on('messages.upsert', async (m) => {
        console.log('Received message:', m.type)

        const msg = m.messages[0]
        if (!msg.message || msg.key.fromMe) return // Abaikan pesan yang dikirim oleh bot sendiri
        if (msg.key && msg.key.remoteJid === 'status@broadcast') return
        
        const number = msg.key.remoteJid
        const messageType = Object.keys(msg.message)[0]
        
        // Ekstrak teks dari berbagai jenis pesan
        let text = ''
        switch (messageType) {
            case 'conversation':
                text = msg.message.conversation
                break
            case 'imageMessage':
                text = msg.message.imageMessage?.caption || ''
                break
            case 'videoMessage':
                text = msg.message.videoMessage?.caption || ''
                break
            case 'extendedTextMessage':
                text = msg.message.extendedTextMessage?.text || ''
                break
            case 'buttonsResponseMessage':
                text = msg.message.buttonsResponseMessage?.selectedButtonId || ''
                break
            case 'listResponseMessage':
                text = msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || ''
                break
            case 'templateButtonReplyMessage':
                text = msg.message.templateButtonReplyMessage?.selectedId || ''
                break
            default:
                text = ''
        }

        // Cek jika pesan adalah command
        if (text.startsWith('.')) {
            const command = text.slice(1).trim().split(/ +/).shift().toLowerCase()
            const args = text.trim().split(/ +/).slice(1)
            const q = args.join(' ')

            console.log(`Command: ${command}, Args: ${args}`)

            if (command === 'menu') {
                let menuText = `
🤖 *BOT MENU* 🤖

Halo! Ini adalah menu bot:

📋 *.menu* - Menampilkan menu ini
🔧 *.execut* [nomor] - Fitur tertentu

Contoh: *.execut 628123456789*
`
                await sock.sendMessage(number, { text: menuText }, { quoted: msg })
            }

            if (command === 'execut') {
                const targetNumber = args[0]
                if (!targetNumber) {
                    await sock.sendMessage(number, { text: "❌ Tolong sertakan nomor target setelah .execut.\nContoh: *.execut 628123456789*" }, { quoted: msg })
                    return
                }

                // Validasi format nomor
                const cleanNumber = targetNumber.replace(/[^0-9]/g, '')
                if (cleanNumber.length < 10) {
                    await sock.sendMessage(number, { text: "❌ Format nomor tidak valid. Pastikan nomor berformat internasional tanpa +" }, { quoted: msg })
                    return
                }

                const virtex = "HAI"
                try {
                    await sock.sendMessage(cleanNumber + "@s.whatsapp.net", { text: virtex })
                    await sock.sendMessage(number, { text: `✅ Virtex berhasil dikirim ke ${cleanNumber}` }, { quoted: msg })
                } catch (error) {
                    console.error("Gagal mengirim virtex:", error)
                    await sock.sendMessage(number, { text: "❌ Gagal mengirim virtex. Pastikan nomor target valid dan terdaftar di WhatsApp." }, { quoted: msg })
                }
            }
        }
    })

    // save credentials whenever updated
    sock.ev.on('creds.update', saveCreds)
}

// Handle error yang tidak tertangkap
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Jalankan bot
connectToWhatsApp().catch(console.error)
