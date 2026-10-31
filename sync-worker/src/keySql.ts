// 키 행 삭제 표시 SQL(설계 2.1·4.6·4.9). keys.ts·profiles.ts·purge.ts가 함께 쓴다. 순환 import를 만들지 않게 아무것도 가져오지 않는다.

/** 암호문을 지우고 리비전만 잇는 삭제 표시. 바인딩: updated_at, user_id, profile_id. 뒤에 ` AND <조건>`을 붙인다 */
export const KEY_TOMBSTONE_SQL =
  'UPDATE key_blobs SET content_id = NULL, nonce = NULL, ciphertext = NULL, revision = revision + 1, updated_at = ? WHERE user_id = ? AND profile_id = ? AND ciphertext IS NOT NULL';
