// 한글 등 IME로 글자를 조합하는 중에 눌린 키인지 가린다(Modern Web Guidance `ime-safe-enter-submit`).
// 조합 중 Enter는 글자 확정용이라 저장·제출로 처리하면 마지막 글자가 빠지거나 두 번 저장된다.
// Safari는 확정 Enter의 keydown이 compositionend 뒤에 와서 isComposing이 false일 수 있으므로,
// 조합 중 keydown에 붙는 keyCode 229(VK_PROCESSKEY)도 함께 본다.

/** IME 조합 중에 눌린 키면 true. Enter 처리 앞에서 확인하고, true면 아무것도 하지 않는다. */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}
