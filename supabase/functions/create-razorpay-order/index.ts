import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const auth = request.headers.get('Authorization')
    if (!auth) return json({ error: 'Missing authorization.' }, 401)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid session.' }, 401)

    const { paymentId } = await request.json()
    if (!paymentId) return json({ error: 'paymentId is required.' }, 400)
    const adminKey = serviceKey()
    if (!adminKey) return json({ error: 'Supabase server key is unavailable in this Edge Function.' }, 500)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey)
    const { data: payment, error: paymentError } = await admin.from('payment_schedule')
      .select('id, amount, status, agreement:agreements!payment_schedule_agreement_id_fkey(borrower_id, status)')
      .eq('id', paymentId).single()
    if (paymentError || !payment) { console.error('Payment lookup failed', { paymentId, paymentError }); return json({ error: 'Payment not found.' }, 404) }
    if (payment.agreement.borrower_id !== user.id) return json({ error: 'Only the borrower can initiate this repayment.' }, 403)
    if (!['scheduled', 'overdue'].includes(payment.status) || payment.agreement.status !== 'active') return json({ error: 'This payment is not payable.' }, 409)

    const { data: existing } = await admin.from('razorpay_orders').select('razorpay_order_id, amount_paise').eq('payment_id', payment.id).eq('status', 'created').maybeSingle()
    if (existing) return json({ orderId: existing.razorpay_order_id, amount: existing.amount_paise, keyId: Deno.env.get('RAZORPAY_KEY_ID') })

    const keyId = Deno.env.get('RAZORPAY_KEY_ID')
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keyId || !keySecret) return json({ error: 'Razorpay secrets are not configured.' }, 500)
    const amount = Math.round(Number(payment.amount) * 100)
    const authorization = `Basic ${btoa(`${keyId}:${keySecret}`)}`
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, currency: 'INR', receipt: `bondly_${payment.id.slice(0, 18)}`, notes: { bondly_payment_id: payment.id } }) })
    const razorpayOrder = await razorpayResponse.json()
    if (!razorpayResponse.ok) return json({ error: razorpayOrder.error?.description || 'Could not create Razorpay order.' }, 502)
    const { error: orderError } = await admin.from('razorpay_orders').upsert({ payment_id: payment.id, razorpay_order_id: razorpayOrder.id, amount_paise: amount, status: 'created', razorpay_payment_id: null, verified_at: null }, { onConflict: 'payment_id' })
    if (orderError) throw orderError
    return json({ orderId: razorpayOrder.id, amount, keyId })
  } catch (error) { return json({ error: error.message || 'Unexpected payment error.' }, 500) }
})
