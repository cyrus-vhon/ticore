/**
 * TICORE Authorization & Security Utilities
 * Enforces role-based and permission-based access checks on the client while
 * relying on Supabase PostgreSQL Row Level Security (RLS) as the source of truth.
 */

export const ROLES = Object.freeze({
  RESIDENT: 'resident',
  OFFICIAL: 'official',
})

export const PERMISSIONS = Object.freeze({
  CAN_MANAGE_RESERVATIONS: 'canManageReservations',
  CAN_MANAGE_COURT_CLOSURES: 'canManageCourtClosures',
  CAN_MANAGE_COURT: 'canManageCourt',
  CAN_CREATE_OFFICIAL: 'canCreateOfficial',
  CAN_VIEW_REPORTS: 'canViewReports',
})

export const DEFAULT_RESIDENT_PERMISSIONS = Object.freeze({
  canManageReservations: false,
  canManageCourtClosures: false,
  canManageCourt: false,
  canCreateOfficial: false,
  canViewReports: false,
})

export const DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS = Object.freeze({
  canManageReservations: true,
  canManageCourtClosures: false,
  canManageCourt: false,
  canCreateOfficial: false,
  canViewReports: true,
})

const ADMIN_ACTION_PERMISSION_MAP = Object.freeze({
  approve_reservation: PERMISSIONS.CAN_MANAGE_RESERVATIONS,
  reject_reservation: PERMISSIONS.CAN_MANAGE_RESERVATIONS,
  cancel_reservation: PERMISSIONS.CAN_MANAGE_RESERVATIONS,
  manage_closures: PERMISSIONS.CAN_MANAGE_COURT_CLOSURES,
  verify_official: PERMISSIONS.CAN_CREATE_OFFICIAL,
  create_official: PERMISSIONS.CAN_CREATE_OFFICIAL,
  view_audit_logs: PERMISSIONS.CAN_VIEW_REPORTS,
})

/**
 * Normalizes a permission map so canManageCourtClosures and canManageCourt stay synchronized
 * and unknown keys are stripped.
 */
export function normalizePermissionsPayload(raw = {}) {
  const manageCourt = Boolean(raw.canManageCourtClosures || raw.canManageCourt)
  return {
    canManageReservations: Boolean(raw.canManageReservations),
    canManageCourtClosures: manageCourt,
    canManageCourt: manageCourt,
    canCreateOfficial: Boolean(raw.canCreateOfficial),
    canViewReports: Boolean(raw.canViewReports),
  }
}

/**
 * 1. AUTHENTICATION CHECK:
 * Checks whether a user has a valid active session and an active profile.
 * Note: An authenticated user is NOT automatically an official.
 */
export function isAuthenticatedUser(user, profile) {
  if (!user || !user.id) return false
  if (profile && profile.is_active === false) return false
  return true
}

/**
 * 2. CONTACT OWNERSHIP VERIFICATION CHECK (OTP):
 * Checks whether the user has verified ownership of their phone/email via OTP.
 * Note: Contact verification NEVER grants official role or administrative privileges.
 */
export function isContactVerified(profile) {
  return Boolean(profile && profile.contact_verified_at)
}

/**
 * Checks whether the authoritative database profile belongs to an active resident.
 */
export function isResidentUser(profile) {
  return Boolean(
    profile &&
      profile.is_active !== false &&
      profile.role === ROLES.RESIDENT
  )
}

/**
 * 3. OFFICIAL VERIFICATION CHECK:
 * Checks whether the authoritative database profile belongs to a verified, active Barangay Official.
 * Unverified, pending, rejected, or revoked accounts are strictly rejected.
 */
export function isVerifiedOfficial(profile) {
  return Boolean(
    profile &&
      profile.is_active === true &&
      profile.role === ROLES.OFFICIAL &&
      profile.verification_status === 'verified'
  )
}

/**
 * 4. GRANULAR AUTHORIZATION CHECK:
 * Checks whether a verified official holds a specific granular permission capability.
 */
export function hasOfficialPermission(profile, permissionKey) {
  if (!isVerifiedOfficial(profile)) return false
  if (!permissionKey) return true
  const perms = profile.permissions || {}
  if (
    permissionKey === PERMISSIONS.CAN_MANAGE_COURT_CLOSURES ||
    permissionKey === PERMISSIONS.CAN_MANAGE_COURT
  ) {
    return Boolean(perms.canManageCourtClosures === true || perms.canManageCourt === true)
  }
  return Boolean(perms[permissionKey] === true)
}

/**
 * Checks whether the user is authorized to perform a specific administrative action.
 */
export function canPerformAdminAction(profile, actionName) {
  const requiredPermission = ADMIN_ACTION_PERMISSION_MAP[actionName]
  if (!requiredPermission) {
    return isVerifiedOfficial(profile)
  }
  return hasOfficialPermission(profile, requiredPermission)
}

/**
 * Evaluates route access requirements for protected pages.
 */
export function evaluateRouteAccess(pageId, { user, profile }) {
  if (pageId === 'account') {
    if (!isAuthenticatedUser(user, profile)) {
      return {
        allowed: false,
        reason: 'unauthenticated',
        message: 'Please sign in to access your Barangay Timugan account profile.',
      }
    }
    return { allowed: true, reason: null, message: null }
  }

  if (
    [
      'official-portal',
      'official-dashboard',
      'official-reservations',
      'official-calendar',
      'official-closures',
    ].includes(pageId)
  ) {
    if (!isAuthenticatedUser(user, profile)) {
      return {
        allowed: false,
        reason: 'unauthenticated',
        message: 'Official authentication is required to access the Barangay Official Dashboard.',
      }
    }
    if (!isVerifiedOfficial(profile)) {
      return {
        allowed: false,
        reason: 'forbidden_official_only',
        message:
          'Access restricted. Only verified Barangay Timugan officials with active administrative credentials may access the Official Dashboard.',
      }
    }
    return { allowed: true, reason: null, message: null }
  }

  return { allowed: true, reason: null, message: null }
}

/**
 * Normalizes a Philippine mobile number (e.g., "0917 123 4567" -> "09171234567")
 * and validates its format.
 */
export function normalizeMobileNumber(rawValue) {
  if (!rawValue) return ''
  const cleaned = String(rawValue).replace(/[\s-]/g, '').trim()
  return cleaned
}

export function isValidPhMobileNumber(rawValue) {
  const cleaned = normalizeMobileNumber(rawValue)
  if (!cleaned) return false
  return /^(\+639|09)\d{9}$/.test(cleaned)
}

/**
 * Strips any protected/privileged fields from profile payloads before sending to Supabase,
 * preventing accidental or malicious client-side privilege escalation payloads.
 */
export function sanitizeProfileUpdatePayload(rawPayload = {}) {
  const allowedFields = {
    full_name: rawPayload.full_name ? String(rawPayload.full_name).trim() : undefined,
    mobile_number:
      rawPayload.mobile_number !== undefined
        ? normalizeMobileNumber(rawPayload.mobile_number) || null
        : undefined,
    residency_type: rawPayload.residency_type,
    province: rawPayload.province ? String(rawPayload.province).trim() : undefined,
    city_municipality: rawPayload.city_municipality
      ? String(rawPayload.city_municipality).trim()
      : undefined,
    barangay: rawPayload.barangay ? String(rawPayload.barangay).trim() : undefined,
    purok_street:
      rawPayload.purok_street !== undefined
        ? String(rawPayload.purok_street || '').trim() || null
        : undefined,
    house_lot_details:
      rawPayload.house_lot_details !== undefined
        ? String(rawPayload.house_lot_details || '').trim() || null
        : undefined,
  }

  return Object.fromEntries(
    Object.entries(allowedFields).filter(([, value]) => value !== undefined)
  )
}

/**
 * Converts technical Supabase/PostgreSQL errors into safe, generic, user-friendly messages.
 * Never exposes internal table/constraint names or account enumeration details.
 */
export function sanitizeAuthError(error, context = 'general') {
  if (!error) return 'An unexpected error occurred. Please try again.'

  const rawMessage = String(error.message || error.error_description || '').toLowerCase()

  if (context === 'login') {
    if (
      rawMessage.includes('invalid login credentials') ||
      rawMessage.includes('invalid_credentials') ||
      rawMessage.includes('user not found') ||
      rawMessage.includes('wrong password')
    ) {
      return 'Invalid email or password. Please check your credentials and try again.'
    }
    if (rawMessage.includes('email not confirmed')) {
      return 'Please verify your email address before signing in. Check your inbox for the confirmation link.'
    }
  }

  if (context === 'register') {
    if (rawMessage.includes('already registered') || rawMessage.includes('already exists')) {
      return 'Unable to complete registration with the provided email or mobile number. If you already have an account, please sign in or reset your password.'
    }
    if (rawMessage.includes('profiles_mobile_number_key')) {
      return 'This mobile number is already associated with an existing account.'
    }
  }

  if (
    rawMessage.includes('security violation') ||
    rawMessage.includes('row-level security') ||
    rawMessage.includes('permission denied')
  ) {
    return 'You are not authorized to perform this action.'
  }

  if (rawMessage.includes('rate limit') || rawMessage.includes('too many requests')) {
    return 'Too many attempts detected. Please wait a moment before trying again.'
  }

  if (rawMessage.includes('password should be at least')) {
    return 'Password must be at least 8 characters long and include a mix of letters and numbers.'
  }

  if (rawMessage.includes('same_password') || rawMessage.includes('different from the old password')) {
    return 'Your new password must be different from your current password.'
  }

  if (rawMessage.includes('jwt expired') || rawMessage.includes('session_not_found')) {
    return 'Your session has expired. Please sign in again to continue.'
  }

  return 'Unable to complete the request right now. Please verify your details and try again.'
}

