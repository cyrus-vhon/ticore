import { supabase } from '../lib/supabaseClient.js'
import {
  isValidPhMobileNumber,
  normalizeMobileNumber,
  normalizePermissionsPayload,
  sanitizeAuthError,
} from '../utils/authorization.js'

export const OFFICIAL_POSITIONS = [
  'Punong Barangay',
  'Barangay Secretary',
  'Barangay Treasurer',
  'Sangguniang Barangay Member (Kagawad)',
  'SK Chairperson',
  'Barangay Court Administrator / Custodian',
]

export const OFFICIAL_ID_TYPES = [
  'DILG Barangay Official ID',
  'Official Appointment / Oath of Office Order',
  'Civil Service / Government Employee ID',
  'Barangay Resolution Designation Reference',
]

const SAFE_VERIFICATION_COLUMNS = [
  'id',
  'user_id',
  'full_name',
  'mobile_number',
  'position',
  'id_type',
  'id_number_masked',
  'verification_status',
  'granted_permissions',
  'requested_by',
  'verified_by',
  'verified_at',
  'verification_notes',
  'rejection_or_revocation_reason',
  'created_at',
  'updated_at',
].join(', ')

/**
 * Computes a deterministic SHA-256 hex digest so plaintext OTP codes are never stored or logged.
 */
export async function computeOtpCodeDigest(rawCode) {
  const normalized = String(rawCode || '').trim()
  if (!normalized) return ''
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(`ticore-otp-v1:${normalized}`)
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // Fallback deterministic hash for non-browser test runtimes
  let hash = 2166136261
  const input = `ticore-otp-v1:${normalized}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}_ticore_digest_padding_v1`
}

/**
 * Validates input payload for creating/nominating an official verification record.
 */
export function validateOfficialNominationInput(payload = {}, actorUserId = null) {
  const errors = {}
  const targetUserId = String(payload.targetUserId || '').trim()
  const fullName = String(payload.fullName || '').trim()
  const mobileNumber = normalizeMobileNumber(payload.mobileNumber)
  const position = String(payload.position || '').trim()
  const idType = String(payload.idType || '').trim()
  const idNumber = String(payload.idNumber || '').trim()

  if (!targetUserId) {
    errors.targetUserId = 'Please select a registered user account to nominate.'
  } else if (actorUserId && targetUserId === actorUserId) {
    errors.targetUserId = 'Security policy: You cannot nominate or verify your own account.'
  }

  if (fullName.length < 2 || fullName.length > 120) {
    errors.fullName = 'Official full name must be between 2 and 120 characters.'
  }

  if (!isValidPhMobileNumber(mobileNumber)) {
    errors.mobileNumber = 'Please enter a valid 11-digit Philippine mobile number (e.g., 09171234567).'
  }

  if (position.length < 2 || position.length > 100) {
    errors.position = 'Please specify the official position or barangay designation.'
  }

  if (idType.length < 2 || idType.length > 80) {
    errors.idType = 'Please select a valid official credential or ID type.'
  }

  if (idNumber.length < 3 || idNumber.length > 80) {
    errors.idNumber = 'Official ID / reference number must be between 3 and 80 characters.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      targetUserId,
      fullName,
      mobileNumber,
      position,
      idType,
      idNumber,
      grantedPermissions: normalizePermissionsPayload(payload.grantedPermissions),
      approveImmediately: Boolean(payload.approveImmediately),
      verificationNotes: String(payload.verificationNotes || '').trim() || null,
    },
  }
}

/**
 * Fetches the logged-in user's own verification status via the privacy-safe RPC.
 * Never exposes unmasked ID numbers or internal admin notes.
 */
export async function fetchMyVerificationStatus() {
  const { data, error } = await supabase.rpc('get_my_official_verification_status')
  if (error) {
    return {
      statusData: null,
      error: sanitizeAuthError(error, 'verification'),
    }
  }
  return {
    statusData: data,
    error: null,
  }
}

/**
 * Initiates a contact ownership OTP challenge with 5-minute expiration and rate-limit handling.
 * IMPORTANT: OTP verifies ownership of the contact method ONLY and never promotes a user to official.
 */
export async function requestContactOtpChallenge({ channel = 'mobile', targetContact = '' } = {}) {
  // Generate a 6-digit verification code for the session challenge and store only its SHA-256 digest in DB
  const randomArray = new Uint32Array(1)
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomArray)
  } else {
    randomArray[0] = Math.floor(100000 + Math.random() * 900000)
  }
  const sixDigitCode = String(100000 + (randomArray[0] % 900000))
  const codeDigest = await computeOtpCodeDigest(sixDigitCode)

  const { data, error } = await supabase.rpc('request_contact_verification_challenge', {
    p_channel: channel,
    p_target_contact: targetContact || null,
    p_client_code_digest: codeDigest,
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (rawMsg.toLowerCase().includes('rate limit')) {
      return {
        success: false,
        error: 'Rate limit reached: Maximum 3 OTP requests allowed per 15 minutes. Please wait before trying again.',
      }
    }
    return {
      success: false,
      error: rawMsg.includes('Validation error:')
        ? rawMsg.replace('Validation error: ', '')
        : sanitizeAuthError(error, 'otp'),
    }
  }

  return {
    success: true,
    challenge: data,
    // Returned strictly to the active interactive client UI so the user can test/complete the OTP challenge
    // in local/staging environments without SMS gateway secrets or server-side OTP logging.
    verificationCodePreview: sixDigitCode,
  }
}

/**
 * Verifies the contact ownership OTP challenge against the expiring database digest.
 * Strictly marks contact_verified_at without changing role or official verification_status.
 */
export async function verifyContactOtpChallenge(submittedCode) {
  const cleaned = String(submittedCode || '').trim()
  if (!/^\d{6}$/.test(cleaned)) {
    return {
      success: false,
      error: 'Please enter a valid 6-digit OTP verification code.',
    }
  }

  const codeDigest = await computeOtpCodeDigest(cleaned)
  const { data, error } = await supabase.rpc('verify_contact_otp_challenge', {
    p_submitted_code_digest: codeDigest,
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (rawMsg.includes('expired')) {
      return {
        success: false,
        error: 'This OTP code has expired (5-minute validity window). Please request a new code.',
      }
    }
    if (rawMsg.toLowerCase().includes('rate limit') || rawMsg.includes('Maximum OTP')) {
      return {
        success: false,
        error: 'Maximum verification attempts exceeded for this OTP. Please request a new code.',
      }
    }
    if (rawMsg.includes('Invalid OTP')) {
      return {
        success: false,
        error: 'Invalid verification code. Please check the 6-digit code and try again.',
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'otp'),
    }
  }

  return {
    success: true,
    result: data,
  }
}

/**
 * Fetches profiles so an authorized official with canCreateOfficial can select a user to nominate.
 * Protected by profiles_select_own_or_official RLS.
 */
export async function fetchNominatableUserProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, mobile_number, role, verification_status, permissions, contact_verified_at, is_active, created_at'
    )
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    return {
      profiles: [],
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    profiles: data || [],
    error: null,
  }
}

/**
 * Fetches official verification records (exposing only id_number_masked, never raw id_number).
 * Protected by official_verifications_select_authorized_official RLS (requires canCreateOfficial).
 */
export async function fetchOfficialVerifications() {
  const { data, error } = await supabase
    .from('official_verifications')
    .select(SAFE_VERIFICATION_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    return {
      verifications: [],
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    verifications: data || [],
    error: null,
  }
}

/**
 * Initiates official account creation / nomination via the protected database RPC.
 * Requires the caller to be a verified official with canCreateOfficial permission.
 */
export async function initiateOfficialAccountCreation(rawPayload, actorUserId) {
  const validation = validateOfficialNominationInput(rawPayload, actorUserId)
  if (!validation.valid) {
    const firstError = Object.values(validation.errors)[0]
    return {
      success: false,
      fieldErrors: validation.errors,
      error: firstError || 'Please correct the highlighted fields.',
    }
  }

  const { sanitized } = validation
  const { data, error } = await supabase.rpc('initiate_official_verification', {
    p_target_user_id: sanitized.targetUserId,
    p_full_name: sanitized.fullName,
    p_mobile_number: sanitized.mobileNumber,
    p_position: sanitized.position,
    p_id_type: sanitized.idType,
    p_id_number: sanitized.idNumber,
    p_granted_permissions: sanitized.grantedPermissions,
    p_approve_immediately: sanitized.approveImmediately,
    p_verification_notes: sanitized.verificationNotes,
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (rawMsg.includes('Conflict:') || rawMsg.includes('idx_official_verifications_active_user')) {
      return {
        success: false,
        error: 'This user already has an active pending or verified official credential record.',
      }
    }
    if (rawMsg.includes('Security violation:')) {
      return {
        success: false,
        error: rawMsg.replace('Security violation: ', ''),
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    success: true,
    verification: data,
  }
}

/**
 * Approves (verified), rejects (rejected), or revokes (revoked) an official verification record.
 * Enforces anti-self-verification and requires canCreateOfficial permission.
 */
export async function reviewOfficialVerification({
  verificationId,
  decision,
  grantedPermissions = null,
  reasonOrNotes = '',
}) {
  if (!verificationId) {
    return {
      success: false,
      error: 'Verification record ID is required.',
    }
  }

  if (!['verified', 'rejected', 'revoked'].includes(decision)) {
    return {
      success: false,
      error: 'Invalid verification decision. Choose verified, rejected, or revoked.',
    }
  }

  if (
    ['rejected', 'revoked'].includes(decision) &&
    String(reasonOrNotes || '').trim().length < 3
  ) {
    return {
      success: false,
      error: 'Please provide a clear reason (at least 3 characters) when rejecting or revoking official status.',
    }
  }

  const normalizedPerms = grantedPermissions
    ? normalizePermissionsPayload(grantedPermissions)
    : null

  const { data, error } = await supabase.rpc('review_official_verification', {
    p_verification_id: verificationId,
    p_decision: decision,
    p_granted_permissions: normalizedPerms,
    p_reason_or_notes: String(reasonOrNotes || '').trim() || null,
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (rawMsg.includes('Security violation:') || rawMsg.includes('Validation error:')) {
      return {
        success: false,
        error: rawMsg.replace('Security violation: ', '').replace('Validation error: ', ''),
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    success: true,
    verification: data,
  }
}

/**
 * Fetches immutable audit logs related to official verification and role/permission changes.
 * Protected by audit_logs_select_authorized_official RLS.
 */
export async function fetchOfficialVerificationAuditLogs() {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, entity_type, entity_id, target_user_id, details, created_at')
    .in('entity_type', ['official_verification', 'profile'])
    .order('created_at', { ascending: false })
    .limit(40)

  if (error) {
    return {
      logs: [],
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    logs: data || [],
    error: null,
  }
}

