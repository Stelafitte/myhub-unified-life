import * as React from 'react'
import { render } from '@react-email/components'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'S_Lafitte Pro'
const REPLY_TO = 'chu@myhub-pro.fr'
const SENDER_DOMAIN = 'notify.echocardio-chubx.fr'
const FROM_DOMAIN = 'notify.echocardio-chubx.fr'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface SendOptions {
  templateName: string
  recipientEmail: string
  templateData?: Record<string, unknown>
  idempotencyKey?: string
}

export interface SendResult {
  success: boolean
  reason?: string
  messageId?: string
}

/**
 * Server-side helper to render + enqueue a transactional email.
 * Uses the admin client to bypass RLS on email infra tables.
 * Call from within an authenticated serverFn handler.
 */
export async function sendTransactionalEmailServer(
  opts: SendOptions,
): Promise<SendResult> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const template = TEMPLATES[opts.templateName]
  if (!template) {
    console.error('[email] template not found', opts.templateName)
    return { success: false, reason: 'template_not_found' }
  }

  const recipient = (template.to || opts.recipientEmail).toLowerCase()
  if (!recipient) return { success: false, reason: 'no_recipient' }

  const messageId = crypto.randomUUID()
  const idempotencyKey = opts.idempotencyKey || messageId
  const data = opts.templateData ?? {}

  // Suppression check
  const { data: suppressed } = await supabaseAdmin
    .from('suppressed_emails')
    .select('id')
    .eq('email', recipient)
    .maybeSingle()
  if (suppressed) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: recipient,
      status: 'suppressed',
    })
    return { success: false, reason: 'email_suppressed' }
  }

  // Unsubscribe token (reuse existing or create)
  let unsubscribeToken: string
  const { data: existing } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', recipient)
    .maybeSingle()

  if (existing && !existing.used_at) {
    unsubscribeToken = existing.token
  } else if (!existing) {
    unsubscribeToken = generateToken()
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: recipient },
        { onConflict: 'email', ignoreDuplicates: true },
      )
    const { data: stored } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', recipient)
      .maybeSingle()
    if (!stored) return { success: false, reason: 'token_failed' }
    unsubscribeToken = stored.token
  } else {
    return { success: false, reason: 'email_suppressed' }
  }

  // Render
  const element = React.createElement(template.component, data)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function' ? template.subject(data) : template.subject

  // Log pending
  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: opts.templateName,
    recipient_email: recipient,
    status: 'pending',
  })

  const { error } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      reply_to: REPLY_TO,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: opts.templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (error) {
    console.error('[email] enqueue failed', error)
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: recipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return { success: false, reason: 'enqueue_failed' }
  }

  return { success: true, messageId }
}
