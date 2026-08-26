import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default

async function hmacHex(message: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const auth = request.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing authorization.' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session.' }, 401)
    const { paymentId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = await request.json()
    if (!paymentId || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) return json({ error: 'Incomplete Razorpay response.' }, 400)

    const adminKey = serviceKey()
    if (!adminKey) return json({ error: 'Supabase server key is unavailable in this Edge Function.' }, 500)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey)
    const { data: payment, error: paymentError } = await admin.from('payment_schedule').select('id, status, agreement:agreements!payment_schedule_agreement_id_fkey(borrower_id)').eq('id', paymentId).single()
    if (paymentError || !payment || payment.agreement.borrower_id !== user.id) return json({ error: 'Payment is unavailable.' }, 403)
    const { data: order, error: orderError } = await admin.from('razorpay_orders').select('*').eq('payment_id', paymentId).eq('razorpay_order_id', razorpay_order_id).single()
    if (orderError || !order) return json({ error: 'Unknown Razorpay order.' }, 404)
    const expected = await hmacHex(`${order.razorpay_order_id}|${razorpay_payment_id}`, Deno.env.get('RAZORPAY_KEY_SECRET')!)
    if (expected !== razorpay_signature) return json({ error: 'Razorpay signature verification failed.' }, 400)

    await admin.from('razorpay_orders').update({ status: 'paid', razorpay_payment_id, verified_at: new Date().toISOString() }).eq('id', order.id)
    const { error: updateError } = await admin.from('payment_schedule').update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: razorpay_payment_id }).eq('id', paymentId)
    if (updateError) throw updateError
    return json({ verified: true })
  } catch (error) { return json({ error: error.message || 'Unexpected verification error.' }, 500) }
})
