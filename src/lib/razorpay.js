import { supabase } from './supabase'

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.onload = resolve
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout.'))
    document.head.appendChild(script)
  })
}

export async function payWithRazorpay(payment, onVerified) {
  if (!supabase) throw new Error('Supabase is required for Razorpay payments.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session has expired. Please sign out and sign in again.')
  const headers = { Authorization: `Bearer ${session.access_token}` }
  const { data: order, error: orderError } = await supabase.functions.invoke('create-razorpay-order', { body: { paymentId: payment.id }, headers })
  if (orderError || order?.error) throw new Error(order?.error || orderError.message)
  await loadCheckout()
  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: 'INR',
      name: 'Bondly',
      description: 'Agreement repayment',
      order_id: order.orderId,
      handler: async (response) => {
        try {
          const { data: verified, error: verifyError } = await supabase.functions.invoke('verify-razorpay-payment', { body: { paymentId: payment.id, ...response }, headers })
          if (verifyError || verified?.error || !verified?.verified) throw new Error(verified?.error || verifyError?.message || 'Payment verification failed.')
          await onVerified()
          resolve()
        } catch (error) { reject(error) }
      },
      modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
      theme: { color: '#1c5d48' },
    })
    checkout.open()
  })
}
