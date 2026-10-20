import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[#06bee1] focus-visible:ring-offset-1 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[#03256c] text-white shadow-[0_1px_3px_rgba(3,37,108,0.12)] hover:bg-[#2541b2] active:bg-[#1768ac]",
        secondary:
          "bg-[#1768ac] text-white shadow-[0_1px_3px_rgba(3,37,108,0.08)] hover:bg-[#03256c] active:bg-[#001242]",
        outline:
          "border-[#d8e2ed] bg-white text-[#03256c] hover:border-[#1768ac] hover:bg-[#f4f7fb] active:bg-[#e8eef6]",
        ghost:
          "text-[#03256c] hover:bg-[#f4f7fb] hover:text-[#2541b2] active:bg-[#e8eef6]",
        destructive:
          "border border-[#ba1a1a]/20 bg-[#ffdad6] text-[#93000a] hover:bg-[#ba1a1a] hover:text-white",
        link: "text-[#1768ac] underline-offset-4 hover:text-[#03256c] hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-3.5",
        xs: "h-6 gap-1 px-2 text-xs",
        sm: "h-7.5 gap-1.5 px-2.5 text-xs font-medium",
        lg: "h-11 gap-2 px-5 text-sm font-semibold sm:text-base",
        icon: "size-9",
        "icon-xs": "size-6",
        "icon-sm": "size-7.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
