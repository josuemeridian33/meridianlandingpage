// Upsert de leads a GoHighLevel para las landings estáticas de este repo.
// Réplica reducida de broker-lander/app/api/ghl/contact/route.ts: solo lo que
// mandan las landings de founders (nombre + teléfono + país + UTMs).
//
// Env vars requeridas en Vercel (Production + Preview):
//   GHL_API_KEY      → Private Integration Token de la location de Meridian
//   GHL_LOCATION_ID  → id de la location
// Si faltan, el endpoint responde 200 {stored:false} para no romper el funnel.

const GHL_URL = 'https://services.leadconnectorhq.com/contacts/upsert'
const GHL_VERSION = '2021-07-28'

// IDs de custom fields de la location de Meridian (GET /locations/{id}/customFields)
const FIELD_IDS = {
  utm_source: 'RgDP2PpBf34MbMoSxpTG',
  utm_medium: 'WxlDMSGOtVbxmQ8RpNbJ',
  utm_campaign: 'DYdhPLRmeSnVe8KB6qpT',
  utm_content: '2UMtEXy95RMzb7NU9Ldd',
  creator_source: 'QvErVMCRYe1LguEMMLtG',
  hero_text: '3jmERhxfMHxtLeCm2KwQ',
}

const CREATORS = ['josue', 'brendan', 'meridian', 'deivin', 'efren']

const ISO = {
  MX: 'MX', CO: 'CO', PE: 'PE', CL: 'CL', AR: 'AR', ES: 'ES', US: 'US', OTHER: 'MX',
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

// CommonJS a propósito: el repo no tiene package.json, así que el runtime de
// Node en Vercel trata los .js como CJS y `export default` sería syntax error.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let body
  try {
    body = await readBody(req)
  } catch (_) {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  const {
    firstName, lastName, phone, email, country, source, url, hero_text,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id,
  } = body

  // Las landings de founders mandan teléfono; las páginas de portal/registro
  // (login, register, crear-cuenta) mandan correo. Basta con uno de los dos.
  const phoneOk = phone && String(phone).replace(/\D/g, '').length >= 7
  const emailOk = email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email))
  if (!phoneOk && !emailOk) {
    return res.status(400).json({ error: 'Teléfono o correo requerido' })
  }

  const apiKey = process.env.GHL_API_KEY
  const locationId = process.env.GHL_LOCATION_ID

  if (!apiKey || !locationId) {
    // Sin credenciales todavía: se registra en los logs de la función y el
    // usuario igual llega al thank-you. Nada de 500 en la cara del lead.
    console.warn('[lead] GHL_API_KEY / GHL_LOCATION_ID sin configurar — lead solo en logs:', JSON.stringify(body))
    return res.status(200).json({ stored: false, reason: 'ghl-no-configurado' })
  }

  const tags = ['meridian', 'founders-program']
  if (source) tags.push(`source:${source}`)

  const customFields = []
  if (utm_source) customFields.push({ id: FIELD_IDS.utm_source, field_value: utm_source })
  if (utm_medium) customFields.push({ id: FIELD_IDS.utm_medium, field_value: utm_medium })
  if (utm_campaign) customFields.push({ id: FIELD_IDS.utm_campaign, field_value: utm_campaign })
  if (utm_content) customFields.push({ id: FIELD_IDS.utm_content, field_value: utm_content })
  if (utm_term) customFields.push({ key: 'utm_term', field_value: utm_term })
  if (utm_id) customFields.push({ key: 'utm_id', field_value: utm_id })
  if (hero_text) customFields.push({ id: FIELD_IDS.hero_text, field_value: hero_text })
  if (utm_content && CREATORS.includes(String(utm_content).toLowerCase())) {
    customFields.push({ id: FIELD_IDS.creator_source, field_value: String(utm_content).toLowerCase() })
  }

  const attributionSource = { sessionSource: 'Landing Page' }
  if (url) attributionSource.url = url
  if (utm_source) attributionSource.utmSource = utm_source
  if (utm_medium) attributionSource.medium = utm_medium
  if (utm_campaign) attributionSource.campaign = utm_campaign
  if (utm_content) attributionSource.utmContent = utm_content
  if (utm_term) attributionSource.utmTerm = utm_term
  if (utm_id) attributionSource.utmId = utm_id

  const contact = {
    locationId,
    firstName,
    lastName,
    ...(phoneOk ? { phone } : {}),
    ...(emailOk ? { email } : {}),
    country: ISO[String(country || '').toUpperCase()] || 'MX',
    source,
    tags,
    ...(customFields.length ? { customFields } : {}),
    attributionSource,
  }

  try {
    const r = await fetch(GHL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact),
    })

    if (!r.ok) {
      const txt = await r.text()
      console.error('[lead] GHL falló:', r.status, txt)
      return res.status(502).json({ error: 'GHL rechazó el contacto', status: r.status })
    }

    const data = await r.json()
    return res.status(200).json({ stored: true, contactId: data?.contact?.id })
  } catch (err) {
    console.error('[lead] request falló:', err)
    return res.status(502).json({ error: 'GHL no respondió' })
  }
}
