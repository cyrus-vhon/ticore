import { useState, useEffect, useCallback, useMemo } from 'react'
import { AuthContext } from './authContextObject.js'
import { supabase } from '../lib/supabaseClient.js'
import {
  ensureResidentProfile,
  fetchUserProfile,
  signInWithEmail,
  signUpResident,
  signOutUser,
  requestPasswordReset,
  updateCurrentUserPassword,
  updateOwnUserProfile,
} from '../services/authService.js'
import {
  isAuthenticatedUser,
  isResidentUser,
  isVerifiedOfficial,
  hasOfficialPermission,
  canPerformAdminAction,
  sanitizeAuthError,
} from '../utils/authorization.js'

export function AuthProvider({ children, navigateTo }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [authNotice, setAuthNotice] = useState(null)
  const [intendedRoute, setIntendedRoute] = useState(null)

  const clearAuthNotice = useCallback(() => {
    setAuthNotice(null)
  }, [])

  const syncUserAndProfile = useCallback(async (activeSession) => {
    if (!activeSession || !activeSession.user) {
      setSession(null)
      setUser(null)
      setProfile(null)
      return null
    }

    // Check if session expiration timestamp has already passed without refresh
    if (activeSession.expires_at && activeSession.expires_at * 1000 < Date.now() - 30000) {
      await signOutUser()
      setSession(null)
      setUser(null)
      setProfile(null)
      setAuthNotice({
        type: 'warning',
        title: 'Session Expired',
        message: 'Your session has expired for security. Please sign in again.',
      })
      return null
    }

    setSession(activeSession)
    setUser(activeSession.user)

    const { profile: loadedProfile } = await ensureResidentProfile(activeSession.user)

    if (loadedProfile && loadedProfile.is_active === false) {
      await signOutUser()
      setSession(null)
      setUser(null)
      setProfile(null)
      setAuthNotice({
        type: 'error',
        title: 'Account Deactivated',
        message:
          'This account is currently inactive. Please contact the Barangay Timugan Office for assistance.',
      })
      return null
    }

    setProfile(loadedProfile)
    return loadedProfile
  }, [])

  useEffect(() => {
    let isMounted = true

    async function initializeAuth() {
      try {
        // Detect password recovery hash in URL if user clicked a reset link
        if (
          window.location.hash.includes('type=recovery') ||
          window.location.hash.includes('reset-password')
        ) {
          if (isMounted) setIsPasswordRecovery(true)
        }

        const { data, error } = await supabase.auth.getSession()
        if (error) {
          if (isMounted) {
            setSession(null)
            setUser(null)
            setProfile(null)
          }
        } else if (isMounted) {
          await syncUserAndProfile(data?.session || null)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    initializeAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        if (!isMounted) return

        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true)
          if (navigateTo) {
            navigateTo('reset-password')
          }
        }

        if (event === 'SIGNED_OUT') {
          setSession(null)
          setUser(null)
          setProfile(null)
          setIsPasswordRecovery(false)
          setLoading(false)
          return
        }

        if (
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          await syncUserAndProfile(nextSession)
          setLoading(false)
        }
      }
    )

    return () => {
      isMounted = false
      authListener?.subscription?.unsubscribe()
    }
  }, [navigateTo, syncUserAndProfile])

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return null
    const { profile: refreshed } = await fetchUserProfile(user.id)
    if (refreshed) {
      setProfile(refreshed)
    }
    return refreshed
  }, [user])

  const signIn = useCallback(
    async ({ email, password }) => {
      setAuthNotice(null)
      const result = await signInWithEmail({ email, password })

      if (result.error) {
        return {
          success: false,
          error: sanitizeAuthError(result.error, 'login'),
        }
      }

      if (result.profile && result.profile.is_active === false) {
        await signOutUser()
        return {
          success: false,
          error:
            'This account is currently inactive. Please contact the Barangay Timugan Office.',
        }
      }

      setSession(result.session)
      setUser(result.user)
      setProfile(result.profile)

      return {
        success: true,
        profile: result.profile,
        user: result.user,
      }
    },
    []
  )

  const signUp = useCallback(async (registrationPayload) => {
    setAuthNotice(null)
    const result = await signUpResident(registrationPayload)

    if (result.error) {
      return {
        success: false,
        error: sanitizeAuthError(result.error, 'register'),
      }
    }

    if (result.session && result.user) {
      setSession(result.session)
      setUser(result.user)
      setProfile(result.profile)
    }

    return {
      success: true,
      user: result.user,
      session: result.session,
      profile: result.profile,
      requiresEmailConfirmation: result.requiresEmailConfirmation,
    }
  }, [])

  const signOut = useCallback(async () => {
    await signOutUser()
    setSession(null)
    setUser(null)
    setProfile(null)
    setIsPasswordRecovery(false)
    setIntendedRoute(null)
  }, [])

  const updateProfile = useCallback(
    async (rawProfileUpdates) => {
      if (!user?.id) {
        return {
          success: false,
          error: 'You must be signed in to update your profile.',
        }
      }

      const { profile: updated, error } = await updateOwnUserProfile(
        user.id,
        rawProfileUpdates
      )

      if (error) {
        return {
          success: false,
          error: sanitizeAuthError(error, 'profile'),
        }
      }

      setProfile(updated)
      return {
        success: true,
        profile: updated,
      }
    },
    [user]
  )

  const sendPasswordReset = useCallback(async (email) => {
    const { error } = await requestPasswordReset(email)
    if (error) {
      return {
        success: false,
        error: sanitizeAuthError(error, 'password_reset'),
      }
    }
    return { success: true }
  }, [])

  const changePassword = useCallback(async (newPassword) => {
    const { user: updatedUser, error } = await updateCurrentUserPassword(newPassword)
    if (error) {
      return {
        success: false,
        error: sanitizeAuthError(error, 'password_update'),
      }
    }
    setIsPasswordRecovery(false)
    if (updatedUser) {
      setUser(updatedUser)
    }
    return { success: true }
  }, [])

  const isAuthenticated = useMemo(
    () => isAuthenticatedUser(user, profile),
    [user, profile]
  )
  const isResident = useMemo(() => isResidentUser(profile), [profile])
  const isOfficial = useMemo(() => isVerifiedOfficial(profile), [profile])

  const hasPermission = useCallback(
    (permissionKey) => hasOfficialPermission(profile, permissionKey),
    [profile]
  )

  const canPerformAction = useCallback(
    (actionName) => canPerformAdminAction(profile, actionName),
    [profile]
  )

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      isPasswordRecovery,
      authNotice,
      setAuthNotice,
      clearAuthNotice,
      intendedRoute,
      setIntendedRoute,
      isAuthenticated,
      isResident,
      isOfficial,
      hasPermission,
      canPerformAction,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      updateProfile,
      sendPasswordReset,
      changePassword,
    }),
    [
      session,
      user,
      profile,
      loading,
      isPasswordRecovery,
      authNotice,
      clearAuthNotice,
      intendedRoute,
      isAuthenticated,
      isResident,
      isOfficial,
      hasPermission,
      canPerformAction,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      updateProfile,
      sendPasswordReset,
      changePassword,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
