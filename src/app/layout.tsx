import type { Metadata } from "next"
import { DM_Serif_Display, DM_Mono, Outfit } from "next/font/google"
import "./globals.css"

const displayFont = DM_Serif_Display({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
})
const monoFont = DM_Mono({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
})
const bodyFont = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
})

export const metadata: Metadata = {
  title: "Securities Mapper",
  description: "Map client securities to model portfolio equivalents",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable} ${bodyFont.variable}`}>
        {children}
      </body>
    </html>
  )
}
