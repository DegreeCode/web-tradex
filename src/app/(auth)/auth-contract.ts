export function registrationBody(registration: { ceremonyId: string; credential: unknown }) {
  return {
    ceremony_id: registration.ceremonyId,
    credential: registration.credential,
  };
}

export function invitationBody(token: string) {
  return {
    invitation_token: token.trim(),
  };
}

export interface PasskeyRegistrationResult {
  recovery_keys?: string[];
}

export function completePasskeyRegistration(
  result: PasskeyRegistrationResult,
  showRecoveryKeys: (keys: string[]) => void,
  finish: () => void,
): void {
  if (result.recovery_keys?.length) {
    showRecoveryKeys(result.recovery_keys);
  } else {
    finish();
  }
}
