'use strict'
const got = require('got')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('distro')

const USER_AGENT = 'MajakgwiLauncher/1.0.3'
const TIMEOUT_MS = 5000
const API_URL = process.env.MAJAKGWI_DISTRO_API_URL ||
    'https://api.github.com/repos/wwa171/NB-Server/contents/distribution.json?ref=main'
const RAW_URL = 'https://raw.githubusercontent.com/wwa171/NB-Server/refs/heads/main/distribution.json'

function reasonOf(err) {
    if (err && err.response && err.response.statusCode) {
        return 'http_' + err.response.statusCode
    }
    if (err && err.name === 'ParseError') {
        return 'json_parse'
    }
    if (err && err.code) {
        return String(err.code).toLowerCase()
    }
    return 'error'
}

async function attempt(tier) {
    const started = Date.now()
    const headers = Object.assign({
        'User-Agent': USER_AGENT,
        'Cache-Control': 'no-cache'
    }, tier.headers || {})
    const res = await got.get(tier.url, {
        responseType: 'json',
        timeout: TIMEOUT_MS,
        retry: 0,
        throwHttpErrors: true,
        headers
    })
    const elapsed = Date.now() - started
    const body = res.body
    if (body == null || typeof body !== 'object' || body.version == null) {
        const err = new Error('manifest_malformed')
        err.code = 'manifest_malformed'
        throw err
    }
    const remaining = res.headers ? res.headers['x-ratelimit-remaining'] : undefined
    return { body, elapsed, remaining }
}

async function resolveDistribution() {
    const envUrl = process.env.MAJAKGWI_DISTRO_URL
    const tiers = envUrl
        ? [{ name: 'env', url: envUrl, headers: {} }]
        : [
            { name: 'api contents', url: API_URL, headers: { 'Accept': 'application/vnd.github.raw' } },
            { name: 'raw fallback', url: RAW_URL, headers: {} }
        ]

    let previousReason = null
    for (const tier of tiers) {
        try {
            const { body, elapsed, remaining } = await attempt(tier)
            const reason = previousReason == null ? '' : ' reason=' + previousReason
            const rate = remaining == null ? '' : ' remaining=' + remaining
            logger.info('[distro] source=' + tier.name + reason + ' version=' + body.version + ' ms=' + elapsed + rate)
            return body
        } catch (err) {
            previousReason = reasonOf(err)
            logger.warn('[distro] source=' + tier.name + ' failed reason=' + previousReason)
        }
    }
    logger.error('[distro] all sources failed')
    return null
}

module.exports = { resolveDistribution, API_URL, RAW_URL, USER_AGENT }