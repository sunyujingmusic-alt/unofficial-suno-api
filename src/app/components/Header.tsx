import Link from "next/link";
import Image from "next/image";
import Logo from "./Logo";

export default function Header() {
    return (
        <nav className=" flex w-full justify-center py-4 items-center 
        border-b border-gray-300  backdrop-blur-2xl font-mono text-sm px-4 lg:px-0">
            <div className="max-w-5xl flex w-full flex-wrap items-center justify-center sm:justify-between gap-3">
                <div className="font-medium text-sm sm:text-xl text-indigo-900 flex items-center gap-2">
                    <Logo className="w-4 h-4" />
                    <Link href='/'>
                        unofficial-suno-api
                    </Link>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 text-xs sm:text-sm font-light text-indigo-900/90">
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <Link href="/">
                            Get Started
                        </Link>
                    </p>
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <Link href="/docs">
                            API Docs
                        </Link>
                    </p>
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <a href="https://github.com/sunyujing/unofficial-suno-api/"
                            target="_blank"
                            className="flex items-center justify-center gap-1">
                            <span className="">
                                <Image src="/github-mark.png" alt="GitHub Logo" width={20} height={20} />
                            </span>
                            <span>GitHub</span>
                        </a>
                    </p>
                </div>



            </div>
        </nav>
    );
}
