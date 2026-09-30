import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  browserSupportsWebAuthn,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";

export interface CeremonyEnvelope<T> {
  ceremony_id: string;
  public_key: { publicKey: T };
}

export interface RegistrationResult {
  credential: RegistrationResponseJSON;
  ceremonyId: string;
}

export interface AuthenticationResult {
  credential: AuthenticationResponseJSON;
  ceremonyId: string;
}

export function supportsPasskeys(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function createPasskey(
  envelope: CeremonyEnvelope<PublicKeyCredentialCreationOptionsJSON>,
): Promise<RegistrationResult> {
  const credential = await startRegistration({ optionsJSON: envelope.public_key.publicKey });
  return { credential, ceremonyId: envelope.ceremony_id };
}

export async function getPasskeyAssertion(
  envelope: CeremonyEnvelope<PublicKeyCredentialRequestOptionsJSON>,
): Promise<AuthenticationResult> {
  const credential = await startAuthentication({ optionsJSON: envelope.public_key.publicKey });
  return { credential, ceremonyId: envelope.ceremony_id };
}

export function webauthnErrorMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    switch (error.name) {
      case "NotAllowedError":
        return "인증이 취소됐어요. 다시 시도해주세요";
      case "InvalidStateError":
        return "이미 등록된 패스키예요";
      case "NotSupportedError":
        return "이 브라우저에서는 패스키를 사용할 수 없어요";
      case "SecurityError":
        return "보안 설정 때문에 패스키를 사용할 수 없어요";
      default:
        return "패스키 처리 중 문제가 발생했어요";
    }
  }
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") return "인증이 취소됐어요. 다시 시도해주세요";
    return error.message || "패스키 처리 중 문제가 발생했어요";
  }
  return "패스키 처리 중 문제가 발생했어요";
}
