import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))',
  				soft: 'hsl(var(--destructive-soft))',
  				border: 'hsl(var(--destructive-border))'
  			},
  			// Semantic status families: use these instead of raw palette classes
  			// (bg-emerald-50, text-amber-600 …) so light/dark pair automatically.
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				foreground: 'hsl(var(--success-foreground))',
  				soft: 'hsl(var(--success-soft))',
  				border: 'hsl(var(--success-border))'
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				foreground: 'hsl(var(--warning-foreground))',
  				soft: 'hsl(var(--warning-soft))',
  				border: 'hsl(var(--warning-border))'
  			},
  			weak: {
  				DEFAULT: 'hsl(var(--weak))',
  				foreground: 'hsl(var(--weak-foreground))',
  				soft: 'hsl(var(--weak-soft))',
  				border: 'hsl(var(--weak-border))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				foreground: 'hsl(var(--info-foreground))',
  				soft: 'hsl(var(--info-soft))',
  				border: 'hsl(var(--info-border))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			// `xl`/`2xl` were the only radii not derived from --radius, so ~29 call
  			// sites silently opted out of the token and would not follow a change
  			// to it. Wiring them is cheaper than chasing every call site.
  			'2xl': 'calc(var(--radius) + 8px)',
  			xl: 'calc(var(--radius) + 4px)',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		minHeight: {
  			touch: '2.75rem'
  		},
  		minWidth: {
  			touch: '2.75rem'
  		},
  		fontSize: {
  			'fluid-xs': 'clamp(0.75rem, 0.72rem + 0.15vw, 0.8125rem)',
  			'fluid-sm': 'clamp(0.875rem, 0.84rem + 0.18vw, 0.9375rem)',
  			'fluid-base': 'clamp(1rem, 0.96rem + 0.2vw, 1.0625rem)',
  			'fluid-lg': 'clamp(1.125rem, 1.06rem + 0.35vw, 1.375rem)',
  			'fluid-xl': 'clamp(1.375rem, 1.24rem + 0.7vw, 1.875rem)',
  			'fluid-2xl': 'clamp(1.75rem, 1.45rem + 1.5vw, 2.625rem)',
  			'fluid-3xl': 'clamp(2.125rem, 1.7rem + 2.2vw, 3.5rem)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'fade-in': {
  				from: { opacity: '0' },
  				to: { opacity: '1' }
  			},
  			'slide-up': {
  				from: { opacity: '0', transform: 'translateY(6px)' },
  				to: { opacity: '1', transform: 'translateY(0)' }
  			},
  			'scale-in': {
  				from: { opacity: '0', transform: 'scale(0.97)' },
  				to: { opacity: '1', transform: 'scale(1)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'fade-in': 'fade-in var(--duration-base) var(--ease-out-soft)',
  			'slide-up': 'slide-up var(--duration-slow) var(--ease-out-soft)',
  			'scale-in': 'scale-in var(--duration-base) var(--ease-out-soft)'
  		},
  		transitionDuration: {
  			fast: 'var(--duration-fast)',
  			base: 'var(--duration-base)',
  			slow: 'var(--duration-slow)'
  		},
  		transitionTimingFunction: {
  			'out-soft': 'var(--ease-out-soft)'
  		},
  		boxShadow: {
  			'2xs': 'var(--shadow-2xs)',
  			xs: 'var(--shadow-xs)',
  			sm: 'var(--shadow-sm)',
  			DEFAULT: 'var(--shadow)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)',
  			'2xl': 'var(--shadow-2xl)'
  		},
  		fontFamily: {
  			sans: [
  				'Work Sans',
  				// Work Sans has no Arabic glyphs; without this the whole Urdu/Arabic
  				// UI falls back to an OS font. See the note in src/index.css.
  				'Noto Naskh Arabic',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica Neue',
  				'Arial',
  				'Noto Sans',
  				'sans-serif'
  			],
  			serif: [
  				'Lora',
  				'Noto Naskh Arabic',
  				'ui-serif',
  				'Georgia',
  				'Cambria',
  				'Times New Roman',
  				'Times',
  				'serif'
  			],
  			mono: [
  				'Inconsolata',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
