import { Navigate } from 'react-router-dom';

/**
 * Legacy OIDC callback route. Authentik has been retired in favor of native
 * email/password auth, so this route just redirects to the native sign-in page.
 */
export default function AuthCallback() {
  return <Navigate to="/login" replace />;
}
