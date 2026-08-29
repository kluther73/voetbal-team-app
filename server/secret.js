const crypto = require('crypto');

const key = crypto.createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || 'development-only-change-this-secret').digest();

const encrypt = value => {
    if (!value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
};

const decrypt = value => {
    if (!value) return null;
    const [ivValue, tagValue, encryptedValue] = value.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64')), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt };
