/** 可用于前端适配层的请求错误，保留状态码与关联标识以便统一展示和排障。 */
export class HttpRequestError extends Error {
  public readonly status: number | undefined
  public readonly correlationId: string

  public constructor(message: string, correlationId: string, status?: number) {
    super(message)
    this.name = 'HttpRequestError'
    this.status = status
    this.correlationId = correlationId
  }
}

/**
 * 调用方必须提供解析函数，将不可信的网络载荷转换为领域类型。
 * 真实接口字段未确认前，基础设施层不预设任何业务响应结构。
 */
export interface JsonRequestOptions<T> extends Omit<RequestInit, 'signal'> {
  correlationId: string
  parse: (payload: unknown) => T
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * 基于 fetch 的轻量请求封装。
 * 每次请求合并外部取消信号与超时控制器，并在结束后清理定时器和监听器，避免单页应用长期运行时泄漏。
 */
export async function requestJson<T>(input: RequestInfo | URL, options: JsonRequestOptions<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(options.signal?.reason)

  if (options.signal?.aborted) {
    controller.abort(options.signal.reason)
  } else {
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timeoutId = window.setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs)
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  try {
    const response = await fetch(input, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new HttpRequestError(`请求失败：${response.status} ${response.statusText}`, options.correlationId, response.status)
    }

    const payload: unknown = response.status === 204 ? null : await response.json()
    return options.parse(payload)
  } catch (error) {
    if (error instanceof HttpRequestError) throw error

    if (controller.signal.aborted) {
      throw new HttpRequestError('请求已取消或超时。', options.correlationId)
    }

    throw new HttpRequestError('网络请求未完成。', options.correlationId)
  } finally {
    window.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}
