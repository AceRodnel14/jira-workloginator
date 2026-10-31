/** Neutral placeholder logo: replace the path with the app's own mark. Uses currentColor, so it follows the theme. */
export function Logo({ height = 32 }: { height?: number }) {
  return (
    <svg className="logo" viewBox="0 0 24 24" height={height} width={height} aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M12 2 21 7v10l-9 5-9-5V7zm0 5.2L7 10v4l5 2.8 5-2.8v-4z" />
    </svg>
  )
}
