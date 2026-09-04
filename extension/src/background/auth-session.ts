/**
 * Connecting, staying connected, and disconnecting.
 *
 * The extension signs in once with the operator's dashboard credentials, immediately exchanges
 * that for a scope-limited extension session, and forgets the dashboard token. The password is
 * never stored, never cached and never leaves this function.
 */
import { apiRequest, ApiError } from './api-client'
import {
  clearConnection,
  readConnection,
  readSettings,
  writeConnection,
  writeSettings,
  type StoredConnection,
} from '../shared/storage'

const EXTENSION_VERSION = chrome.runtime.getManifest().version

interface LoginResponse {
  access_token: string
  expires_at: string
}

interface ConnectResponse {
  access_token: string
  expires_at: string
  installation_id: string
  workspace_name: string
  user_email: string
}

export async function connect(params: {
  dashboardUrl: string
  email: string
  password: string
  label: string
}): Promise<StoredConnection> {
  const settings = await writeSettings({
    dashboardUrl: params.dashboardUrl.replace(/\/+$/, ''),
    label: params.label,
  })

  const login = await apiRequest<LoginResponse>(settings.dashboardUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: params.email, password: params.password },
  })

  // The dashboard token is used for exactly one call and then dropped. It is deliberately not
  // written to storage: a token that can change readiness has no business living in a browser
  // extension.
  const exchanged = await apiRequest<ConnectResponse>(
    settings.dashboardUrl,
    '/api/v1/extension/connect',
    {
      method: 'POST',
      token: login.access_token,
      body: {
        extension_instance_id: settings.instanceId,
        extension_version: EXTENSION_VERSION,
        label: params.label,
      },
    },
  )

  const connection: StoredConnection = {
    accessToken: exchanged.access_token,
    expiresAt: exchanged.expires_at,
    installationId: exchanged.installation_id,
    workspaceName: exchanged.workspace_name,
    userEmail: exchanged.user_email,
  }
  await writeConnection(connection)
  return connection
}

export async function disconnect(reason: string): Promise<void> {
  const [connection, settings] = await Promise.all([readConnection(), readSettings()])
  if (connection && settings.dashboardUrl) {
    try {
      // Best effort: revoking server-side is what actually cuts the session off, but a failure
      // here must still clear the local token rather than leave the operator "connected".
      await apiRequest(settings.dashboardUrl, '/api/v1/extension/installations/revoke', {
        method: 'POST',
        token: connection.accessToken,
        body: { installation_id: connection.installationId, reason },
      })
    } catch {
      /* fall through to clearing local state */
    }
  }
  await clearConnection()
}

/** The current session, or null. Never throws: "not connected" is an ordinary state. */
export async function currentConnection(): Promise<StoredConnection | null> {
  return readConnection()
}

/**
 * Run an API call with the extension session, clearing it if the server says it is gone.
 *
 * A revoked installation returns 401, and the right response is to stop pretending we are
 * connected rather than to retry.
 */
export async function withSession<T>(
  run: (baseUrl: string, token: string) => Promise<T>,
): Promise<T> {
  const [connection, settings] = await Promise.all([readConnection(), readSettings()])
  if (!connection || !settings.dashboardUrl) {
    throw new ApiError('The extension is not connected.', 401, 'not_connected')
  }
  try {
    return await run(settings.dashboardUrl, connection.accessToken)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      await clearConnection()
    }
    throw error
  }
}

export { EXTENSION_VERSION }
