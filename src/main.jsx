import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './auth.css'
import './inbox.css'
import './payments.css'
import './notifications.css'
import './dashboard.css'
import './ai.css'
import './recovery.css'
import './recovery-ai.css'
import './reputation.css'
import './reputation-structured.css'
import './role-access.css'
import './financial-health.css'

class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <main style={{ padding: 40, maxWidth: 600 }}><p className="eyebrow">BONDLY STARTUP ISSUE</p><h1>We couldn’t load the app.</h1><p style={{ color: '#68736e' }}>{this.state.error.message}</p><button className="primary" onClick={() => window.location.reload()}>Reload app</button></main> : this.props.children }
}

createRoot(document.getElementById('root')).render(
  <StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>,
)
