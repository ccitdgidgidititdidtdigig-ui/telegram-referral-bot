const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const bot = new Telegraf('7569379591:AAEDe2EdzLWMvLvirXWiegddVtleTTH8p6k');
const CHANNEL = '@otzuvnoy';

// База данных
const db = new sqlite3.Database('./referral.db');

// Создание таблицы
db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    balance REAL DEFAULT 0.0,
    referral_id TEXT UNIQUE,
    referred_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Генерация реферального ID
function generateReferralId(userId) {
    return `REF_${userId}_${uuidv4().slice(0, 8)}`;
}

// Команда /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || 'Пользователь';

    try {
        // Проверка существования пользователя
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (!user) {
            // Создание нового пользователя
            const referralId = generateReferralId(userId);
            await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO users (user_id, username, first_name, balance, referral_id) VALUES (?, ?, ?, ?, ?)',
                    [userId, username, firstName, 0.0, referralId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Обработка реферальной ссылки
            const args = ctx.message.text.split(' ');
            if (args.length > 1) {
                const referrerRef = args[1];
                const referrer = await new Promise((resolve, reject) => {
                    db.get('SELECT user_id FROM users WHERE referral_id = ?', [referrerRef], (err, row) => {
                        if (err) reject(err);
                        resolve(row);
                    });
                });

                if (referrer) {
                    // Начисление 1% рефереру
                    await new Promise((resolve, reject) => {
                        db.run('UPDATE users SET balance = balance + 1 WHERE user_id = ?', [referrer.user_id], (err) => {
                            if (err) reject(err);
                            resolve();
                        });
                    });
                    
                    await new Promise((resolve, reject) => {
                        db.run('UPDATE users SET referred_by = ? WHERE user_id = ?', [referrerRef, userId], (err) => {
                            if (err) reject(err);
                            resolve();
                        });
                    });

                    // Уведомление реферера
                    try {
                        await ctx.telegram.sendMessage(referrer.user_id, `🎉 Новый реферал! Баланс +1%`);
                    } catch (e) {}
                }
            }
        }

        // Получение реферальной ссылки
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT referral_id FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const referralLink = `https://t.me/${ctx.botInfo.username}?start=${row.referral_id}`;
        
        const welcomeText = `
👋 Привет, ${firstName}!

Добро пожаловать в реферальную систему канала ${CHANNEL}!

📊 Ваша реферальная ссылка:
${referralLink}

За каждого приглашённого друга вы получаете +1% к балансу.

🎁 При достижении 100% вы получаете бесплатный купон на:
• Тариф "Фикс бага"
• Тариф "Фикс функций"

Используйте кнопки ниже для управления ботом.
        `;

        const keyboard = {
            reply_markup: {
                keyboard: [
                    [{ text: '💰 Баланс' }, { text: '👤 Профиль' }],
                    [{ text: '🔗 Реферальная ссылка' }]
                ],
                resize_keyboard: true
            }
        };

        await ctx.reply(welcomeText, keyboard);
        checkBalance(ctx, userId);
        
    } catch (error) {
        console.error('Ошибка:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
});

// Обработка кнопок
bot.hears('💰 Баланс', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const balance = row.balance;
        let bonusText = '';
        
        if (balance >= 100) {
            bonusText = '\n\n🎉 Поздравляем! Вы достигли 100% баланса!\nВы получаете БЕСПЛАТНЫЙ купон на:\n• Тариф "Фикс бага"\n• Тариф "Фикс функций"\n\nСвяжитесь с администратором для активации.';
        } else {
            bonusText = `\n\nДо бесплатного купона осталось: ${100 - balance}%`;
        }
        
        await ctx.reply(`💰 Ваш текущий баланс: ${balance}%${bonusText}`);
        checkBalance(ctx, userId);
        
    } catch (error) {
        console.error('Ошибка:', error);
    }
});

bot.hears('👤 Профиль', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        if (user) {
            const profileText = `
👤 ПРОФИЛЬ:

🆔 ID: ${user.user_id}
👤 Имя: ${user.first_name}
📛 Юзернейм: @${user.username || 'не установлен'}
💰 Баланс: ${user.balance}%
🔗 Реферальный ID: ${user.referral_id}
👥 Приглашён: ${user.referred_by ? 'да' : 'нет'}
📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}
            `;
            await ctx.reply(profileText);
        }
    } catch (error) {
        console.error('Ошибка:', error);
    }
});

bot.hears('🔗 Реферальная ссылка', async (ctx) => {
    const userId = ctx.from.id;
    
    try {
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT referral_id FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const referralLink = `https://t.me/${ctx.botInfo.username}?start=${row.referral_id}`;
        
        const countRow = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [row.referral_id], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const refCount = countRow.count;
        
        const linkText = `
🔗 ВАША РЕФЕРАЛЬНАЯ ССЫЛКА:

${referralLink}

👥 Количество приглашённых: ${refCount} человек
💰 Заработано: ${refCount}%

📢 Отправьте эту ссылку друзьям!
Каждый приглашённый друг = +1% к вашему балансу.

🎯 Цель: 100% = бесплатный купон на:
• Тариф "Фикс бага"
• Тариф "Фикс функций"
        `;
        await ctx.reply(linkText);
        
    } catch (error) {
        console.error('Ошибка:', error);
    }
});

// Функция проверки баланса
async function checkBalance(ctx, userId) {
    try {
        const row = await new Promise((resolve, reject) => {
            db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, row) => {
                if (err) reject(err);
                resolve(row);
            });
        });

        const balance = row.balance;
        
        if (balance >= 100) {
            const couponText = `
🎉🎉🎉 ПОЗДРАВЛЯЕМ! 🎉🎉🎉

Вы достигли 100% баланса в реферальной системе!

🏆 ВАША НАГРАДА:

Вы получаете БЕСПЛАТНЫЙ КУПОН на выбор:

1. ТАРИФ "ФИКС БАГА"
   • Исправление любых багов в проекте
   • Оптимизация кода
   • Тестирование и отладка

2. ТАРИФ "ФИКС ФУНКЦИЙ"
   • Добавление новых функций
   • Улучшение существующих
   • Интеграция с API

📞 Для активации купона свяжитесь с администратором:
👉 ${CHANNEL}

Спасибо за участие в реферальной программе!
            `;
            await ctx.telegram.sendMessage(userId, couponText);
        }
    } catch (error) {
        console.error('Ошибка проверки баланса:', error);
    }
}

// Запуск бота
bot.launch()
    .then(() => console.log('🤖 Бот запущен!'))
    .catch(err => console.error('Ошибка запуска:', err));

// Включение graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
