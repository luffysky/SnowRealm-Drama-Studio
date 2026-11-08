'use client'

import { useSyncExternalStore } from 'react'

/**
 * Browser notifications for new messages and incoming calls.
 *
 * Asked for, never demanded. A permission prompt that fires on page load is
 * the one every browser now suppresses and every person reflexively blocks —
 * so the request is attached to a control someone chooses to press, and a
 * refusal is simply respected: the app still works, it just does not ring.
 *
 * `showNotification` through the service worker where one is active, because
 * `new Notification()` is deprecated on Android and throws there.
 */

export type NotifyInput = {
  title: string
  body: string
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string
  requireInteraction?: boolean
  /**
   * Where to go if no window is open when it is clicked (Z193).
   *
   * Only used in that case: the worker focuses an already-open tab instead,
   * because the chat and the call both live in a widget that tab has already
   * mounted, and navigating it would discard whatever was open there.
   */
  url?: string
}

export function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!canNotify()) return 'unsupported'
  return Notification.permission
}

/**
 * Shows one, if allowed.
 *
 * Silent when permission was never granted — the caller should not have to
 * check, and a thrown error here would take down whatever was rendering.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (!canNotify() || Notification.permission !== 'granted') return

  // Not while the page is in front: the message is already on screen, and a
  // notification for something visible is noise.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    if (!input.requireInteraction) return
  }

  const options: NotificationOptions = {
    body: input.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    ...(input.tag ? { tag: input.tag } : {}),
    ...(input.requireInteraction ? { requireInteraction: true } : {}),
    // The worker reads this in `notificationclick`; see public/sw.js.
    data: { url: input.url ?? '/dashboard' },
  }

  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      await registration.showNotification(input.title, options)
      return
    }
    new Notification(input.title, options)
  } catch {
    // Android throws on the constructor; a missing worker is the usual cause
    // and there is nothing useful to say about it.
  }
}

/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  /*
   * `permissions.query` fires when the setting changes from the browser's own
   * UI — the padlock menu — which no event on `Notification` reports.
   */
  let status: PermissionStatus | null = null
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((result) => {
        status = result
        result.addEventListener('change', notifyAll)
      })
      .catch(() => {})
  }

  return () => {
    listeners.delete(listener)
    status?.removeEventListener('change', notifyAll)
  }
}

function notifyAll() {
  for (const listener of listeners) listener()
}

/** Re-renders when the permission changes, including from browser settings. */
export function useNotificationPermission(): NotificationPermission | 'unsupported' {
  return useSyncExternalStore(subscribe, notificationPermission, () => 'unsupported' as const)
}

/**
 * Asks, and reports what was decided.
 *
 * Must be called from a user gesture or browsers reject it outright.
 */
export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!canNotify()) return 'unsupported'

  try {
    const result = await Notification.requestPermission()
    notifyAll()
    return result
  } catch {
    return Notification.permission
  }
}
