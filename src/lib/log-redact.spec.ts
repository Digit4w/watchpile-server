import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetSecrets,
  REDACTED,
  redactLine,
  registerSecret,
} from './log-redact.js'

afterEach(() => {
  forgetSecrets()
})

describe('redactLine', () => {
  it('tira um segredo registrado de onde quer que ele esteja', () => {
    registerSecret('tmdb-key-0123456789')
    const line = JSON.stringify({
      msg: 'fetch failed',
      err: { message: 'GET /3/search/movie?q=x&k=tmdb-key-0123456789 failed' },
    })

    const out = redactLine(line)

    expect(out).not.toContain('tmdb-key-0123456789')
    expect(out).toContain(REDACTED)
  })

  it('ignora segredo curto demais, que casaria com qualquer coisa', () => {
    registerSecret('abc')
    expect(redactLine('{"msg":"abcdef"}')).toBe('{"msg":"abcdef"}')
  })

  it('tira cookie e authorization pelo NOME, sem registro nenhum', () => {
    const line = JSON.stringify({
      req: {
        headers: {
          cookie: 'watchpile_session=9b3e12.XbdkNr%3D',
          authorization: 'Bearer abc.def',
          accept: '*/*',
        },
      },
    })

    const out = JSON.parse(redactLine(line))

    expect(out.req.headers.cookie).toBe(REDACTED)
    expect(out.req.headers.authorization).toBe(REDACTED)
    expect(out.req.headers.accept).toBe('*/*')
  })

  it('não se confunde com aspas escapadas dentro do valor', () => {
    const line = JSON.stringify({ password: 'a"b\\"c', next: 'kept' })

    const out = JSON.parse(redactLine(line))

    expect(out.password).toBe(REDACTED)
    expect(out.next).toBe('kept')
  })

  it('tira credencial de query string, e só o valor', () => {
    const out = redactLine(
      '{"url":"https://api.x/token?client_id=idv&client_secret=s3cr3t&grant_type=cc"}',
    )

    expect(out).toContain(`client_id=${REDACTED}`)
    expect(out).toContain(`client_secret=${REDACTED}`)
    expect(out).toContain('grant_type=cc')
    expect(out).not.toContain('s3cr3t')
  })

  it('deixa intacta a linha sem nada sensível', () => {
    const line = '{"level":30,"msg":"import finished","added":426}'
    expect(redactLine(line)).toBe(line)
  })
})
