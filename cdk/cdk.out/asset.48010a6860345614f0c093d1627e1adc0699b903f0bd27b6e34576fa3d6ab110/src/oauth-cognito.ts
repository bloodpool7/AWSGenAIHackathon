import { createRemoteJWKSet, jwtVerify } from "jose";

interface TokenValidationResult {
  isValid: boolean;
  payload?: any;
}

/**
 * Validates a Cognito JWT token using JWKS verification.
 * @param token - The JWT access token from Cognito
 * @returns Promise with validation result
 */
export async function validateCognitoToken(
  token: string
): Promise<TokenValidationResult> {
  const region = process.env.AWS_REGION || "us-west-2";
  const userPoolId = process.env.COGNITO_USER_POOL_ID;

  if (!userPoolId) {
    console.error("COGNITO_USER_POOL_ID environment variable not set");
    return { isValid: false };
  }

  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const JWKS = createRemoteJWKSet(new URL(jwksUrl));

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    });

    console.log("Token validated successfully:", payload);
    return { isValid: true, payload };
  } catch (error) {
    console.error("Token validation failed:", error);
    return { isValid: false };
  }
}
