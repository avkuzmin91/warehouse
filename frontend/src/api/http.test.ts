import { describe, expect, it } from 'vitest'
import { formatApiErrorDetail } from './http'

describe('formatApiErrorDetail', () => {
  it('строковый detail возвращается как есть (с trim)', () => {
    expect(formatApiErrorDetail({ detail: 'Документ не найден' }, 404)).toBe('Документ не найден')
    expect(formatApiErrorDetail({ detail: '  Укажите клиента  ' }, 400)).toBe('Укажите клиента')
  })

  it('строковое тело целиком — тоже ошибка', () => {
    expect(formatApiErrorDetail('Внутренняя ошибка', 500)).toBe('Внутренняя ошибка')
  })

  it('массив валидации FastAPI собирается в строку с именем поля (без "body")', () => {
    const body = { detail: [{ loc: ['body', 'email'], msg: 'обязательное поле' }] }
    expect(formatApiErrorDetail(body, 422)).toBe('email: обязательное поле')
  })

  it('loc из одного "body" отфильтровывается — остаётся только msg', () => {
    const body = { detail: [{ loc: ['body'], msg: 'некорректный запрос' }] }
    expect(formatApiErrorDetail(body, 422)).toBe('некорректный запрос')
  })

  it('несколько ошибок валидации склеиваются через пробел', () => {
    const body = {
      detail: [
        { loc: ['body', 'email'], msg: 'обязательное поле' },
        { loc: ['body', 'qty'], msg: 'должно быть больше 0' },
      ],
    }
    expect(formatApiErrorDetail(body, 422)).toBe('email: обязательное поле qty: должно быть больше 0')
  })

  it('массив строк в detail поддерживается', () => {
    expect(formatApiErrorDetail({ detail: ['первая', 'вторая'] }, 400)).toBe('первая вторая')
  })

  it('объектный detail с msg/message', () => {
    expect(formatApiErrorDetail({ detail: { msg: 'нет доступа' } }, 403)).toBe('нет доступа')
    expect(formatApiErrorDetail({ detail: { message: 'нет доступа' } }, 403)).toBe('нет доступа')
  })

  it('message на верхнем уровне — фолбэк после detail', () => {
    expect(formatApiErrorDetail({ message: 'что-то пошло не так' }, 500)).toBe('что-то пошло не так')
  })

  it('пустое тело → дружелюбный фолбэк с кодом', () => {
    expect(formatApiErrorDetail(null, 500)).toContain('500')
    expect(formatApiErrorDetail(undefined, 404)).toContain('404')
  })

  it('код 0 (сеть) → фолбэк без кода', () => {
    const msg = formatApiErrorDetail(null, 0)
    expect(msg).not.toContain('код')
    expect(msg).toContain('Не удалось выполнить запрос')
  })

  it('пустая строка и пустой detail → фолбэк', () => {
    expect(formatApiErrorDetail('   ', 500)).toContain('500')
    expect(formatApiErrorDetail({ detail: '' }, 500)).toContain('500')
    expect(formatApiErrorDetail({ detail: [] }, 500)).toContain('500')
    expect(formatApiErrorDetail(42, 500)).toContain('500')
  })
})
