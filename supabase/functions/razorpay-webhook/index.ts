import { createClient } from 'npm:@supabase/supabase-js@2'

const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default

async function hmacHex(message: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  try {
    const rawBody = await request.text()
    const receivedSignature = request.headers.get('x-razorpay-signature')
    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
    if (!receivedSignature || !webhookSecret) return new Response('Unauthorized', { status: 401 })
    const expectedSignature = await hmacHex(rawBody, webhookSecret)
    if (expectedSignature !== receivedSignature) return new Response('Invalid signature', { status: 400 })

    const event = JSON.parse(rawBody)
    const eventId = request.headers.get('x-razorpay-event-id')
    const adminKey = serviceKey()
    if (!adminKey) throw new Error('Supabase server key is unavailable.')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey)
    if (eventId) {
      const { error: duplicateCheck } = await admin.from('razorpay_webhook_events').insert({ event_id: eventId, event_type: event.event || 'unknown' })
      if (duplicateCheck?.code === '23505') return new Response('ok', { status: 200 })
      if (duplicateCheck) throw duplicateCheck
    }

    const payment = event.payload?.payment?.entity
    if (!payment?.order_id) return new Response('ok', { status: 200 })
    const { data: order } = await admin.from('razorpay_orders').select('id, payment_id, status').eq('razorpay_order_id', payment.order_id).maybeSingle()
    if (!order) return new Response('ok', { status: 200 })

    if (event.event === 'payment.captured') {
      await admin.from('razorpay_orders').update({ status: 'paid', razorpay_payment_id: payment.id, verified_at: new Date().toISOString() }).eq('id', order.id)
      await admin.from('payment_schedule').update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: payment.id }).eq('id', order.payment_id).neq('status', 'paid')
    } else if (event.event === 'payment.failed') {
      await admin.from('razorpay_orders').update({ status: 'failed', razorpay_payment_id: payment.id }).eq('id', order.id)
    }
    return new Response('ok', { status: 200 })
  } catch (error) { console.error('Razorpay webhook error', error); return new Response('Webhook processing failed', { status: 500 }) }
})
