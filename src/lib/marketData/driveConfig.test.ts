import { expect, it } from 'vitest';
import { readDriveClientId } from './driveConfig';
it('빈 값·공백은 null, 값은 다듬어 돌려준다', () => {
  expect(readDriveClientId({})).toBeNull();
  expect(readDriveClientId({ VITE_GOOGLE_DRIVE_CLIENT_ID: '  ' })).toBeNull();
  expect(readDriveClientId({ VITE_GOOGLE_DRIVE_CLIENT_ID: ' abc.apps.googleusercontent.com ' })).toBe('abc.apps.googleusercontent.com');
});
