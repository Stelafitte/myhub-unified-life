import type { ComponentType } from 'react'
import { template as spaceInvitation } from './space-invitation'
import { template as spaceUpdate } from './space-update'
import { template as spaceJoinRequest } from './space-join-request'
import { template as spaceJoinApproved } from './space-join-approved'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'space-invitation': spaceInvitation,
  'space-update': spaceUpdate,
  'space-join-request': spaceJoinRequest,
  'space-join-approved': spaceJoinApproved,
}
