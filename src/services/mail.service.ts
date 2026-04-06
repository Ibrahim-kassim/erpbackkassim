import nodemailer from 'nodemailer';
import { ISystemConfig } from '../models/systemConfig.model';

class ServiceError extends Error {
    constructor(message: string, public code: string = 'VALIDATION_ERROR') {
        super(message);
        this.name = 'ServiceError';
    }
}

type MailAttachment = {
    filename: string;
    contentBase64: string;
    contentType: string;
};

type SendMailArgs = {
    config: ISystemConfig;
    to: string;
    subject: string;
    body: string;
    attachment?: MailAttachment;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const toHtml = (body: string) =>
    escapeHtml(body)
        .split(/\r?\n\r?\n/)
        .map((paragraph) => `<p style="margin:0 0 14px 0;">${paragraph.replace(/\r?\n/g, '<br/>')}</p>`)
        .join('');

const getEmailSettings = (config: ISystemConfig) => {
    const senderEmail = config.emailSettings?.senderEmail || config.email;
    const senderName = config.emailSettings?.senderName || config.companyName || 'ERP Core';
    const replyToEmail = config.emailSettings?.replyToEmail || senderEmail;
    const smtpHost = config.emailSettings?.smtpHost;
    const smtpPort = config.emailSettings?.smtpPort || 587;
    const smtpSecure = Boolean(config.emailSettings?.smtpSecure);
    const smtpUsername = config.emailSettings?.smtpUsername;
    const smtpPassword = config.emailSettings?.smtpPassword;

    if (!senderEmail) throw new ServiceError('Set a company sender email in Settings before sending RFQs.');
    if (!smtpHost || !smtpUsername || !smtpPassword) {
        throw new ServiceError('Complete the SMTP host, username, and password in Settings before sending RFQs.');
    }

    return {
        senderEmail,
        senderName,
        replyToEmail,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUsername,
        smtpPassword,
    };
};

export const sendConfiguredMail = async ({ config, to, subject, body, attachment }: SendMailArgs) => {
    const settings = getEmailSettings(config);

    const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        auth: {
            user: settings.smtpUsername,
            pass: settings.smtpPassword,
        },
    });

    try {
        await transporter.sendMail({
            from: `"${settings.senderName}" <${settings.senderEmail}>`,
            to,
            replyTo: settings.replyToEmail,
            subject,
            text: body,
            html: `
              <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
                <div style="max-width: 680px; margin: 0 auto; padding: 24px;">
                  <div style="margin-bottom: 24px;">
                    <div style="font-size: 20px; font-weight: 700;">${escapeHtml(settings.senderName)}</div>
                    <div style="font-size: 13px; color: #64748b;">${escapeHtml(settings.senderEmail)}</div>
                  </div>
                  ${toHtml(body)}
                </div>
              </div>
            `,
            attachments: attachment
                ? [
                    {
                        filename: attachment.filename,
                        content: Buffer.from(attachment.contentBase64, 'base64'),
                        contentType: attachment.contentType,
                    },
                ]
                : undefined,
        });
    } catch (error) {
        const smtpError = error as { code?: string; response?: string; message?: string };
        const rawMessage = smtpError.response || smtpError.message || 'Unable to send email through SMTP.';

        if (smtpError.code === 'EAUTH') {
            throw new ServiceError(
                'SMTP authentication failed. For Gmail, use your full Gmail address as the username and a Google App Password instead of your normal password.',
            );
        }

        if (smtpError.code === 'ESOCKET' || smtpError.code === 'ECONNECTION' || smtpError.code === 'ETIMEDOUT') {
            throw new ServiceError(
                `Unable to connect to the SMTP server. Check the host, port, secure setting, and whether the server allows external SMTP connections. (${rawMessage})`,
            );
        }

        throw new ServiceError(`Email delivery failed: ${rawMessage}`);
    }
};
