interface TemplateData {
  recipientName: string;
  title: string;
  body?: string;
  link?: string;
  appUrl?: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SUBJECTS: Record<string, (data: TemplateData) => string> = {
  issue_assigned: (d) => `Issue assigned: ${d.title}`,
  issue_commented: (d) => `New comment: ${d.title}`,
  pr_review_requested: (d) => `Review requested: ${d.title}`,
  pr_merged: (d) => `Pull request merged: ${d.title}`,
  mention: (d) => `You were mentioned: ${d.title}`,
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(data: TemplateData, subject: string): string {
  const actionUrl = data.link ? `${data.appUrl || 'http://localhost:7000'}${data.link}` : null;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e2e4e9;">
        <tr><td style="padding:24px 32px 16px;">
          <h2 style="margin:0 0 4px;font-size:18px;color:#1a1a2e;">${escapeHtml(subject)}</h2>
          <p style="margin:0;font-size:13px;color:#6b7280;">Hi ${escapeHtml(data.recipientName)},</p>
        </td></tr>
        ${
          data.body
            ? `<tr><td style="padding:0 32px 16px;">
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">${escapeHtml(data.body)}</p>
        </td></tr>`
            : ''
        }
        ${
          actionUrl
            ? `<tr><td style="padding:0 32px 24px;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:8px 20px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">View in Axiom</a>
        </td></tr>`
            : ''
        }
        <tr><td style="padding:16px 32px;border-top:1px solid #e2e4e9;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">You received this because of your notification preferences in Axiom. You can update them in Settings.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(data: TemplateData, subject: string): string {
  const lines = [subject, '', `Hi ${data.recipientName},`];
  if (data.body) lines.push('', data.body);
  if (data.link) {
    const actionUrl = `${data.appUrl || 'http://localhost:7000'}${data.link}`;
    lines.push('', `View in Axiom: ${actionUrl}`);
  }
  lines.push('', '---', 'You received this because of your notification preferences in Axiom.');
  return lines.join('\n');
}

/**
 *
 * @param type
 * @param data
 */
export function renderEmailTemplate(type: string, data: TemplateData): RenderedEmail {
  const subjectFn = SUBJECTS[type] || ((d: TemplateData) => d.title);
  const subject = subjectFn(data);
  return {
    subject,
    html: buildHtml(data, subject),
    text: buildText(data, subject),
  };
}
