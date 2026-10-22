const en = {
  home: {
    badge: "Spoken English Training",
    title: "Speak until the words come easily.",
    description:
      "Fluency provides an immediate, voice-first conversation partner. Select a realistic scenario, speak aloud, and engage in real-time dialogue without friction.",
    startPracticing: "Start practicing",
    browseScenarios: "Browse scenarios",
    steps: [
      {
        number: "01",
        title: "You speak",
        body: "Hold the mic and say a sentence. Fast in-browser speech recognition transcribes your words immediately.",
      },
      {
        number: "02",
        title: "A partner answers",
        body: "Your partner responds in natural, spoken English tailored to your scenario, maintaining operational flow.",
      },
      {
        number: "03",
        title: "You hear it",
        body: "The reply is vocalized aloud via speech synthesis, seamlessly returning the conversation back to you.",
      },
    ],
    panelBadge: "Operational Focus",
    panelTitle: "Designed for spoken muscle memory",
    panelBody:
      "Real-world conversations require immediate vocal retrieval. Fluency bypasses passive exercises to build verbal confidence in low-stakes simulation.",
    panelCta: "Launch Session",
  },
  picker: {
    badge: "Select Practice Scenario",
    title: "What do you want to practice?",
    subtitle:
      "Choose an environment. You will speak aloud, hear an immediate response, and guide the dialogue back and forth.",
    defaultTag: "Scenario",
    begin: "Begin dialogue",
  },
  scenarios: {
    "free-chat": {
      title: "Free chat",
      description: "Talk about your day, your plans, or whatever is on your mind.",
      tag: "Spontaneous",
    },
    "job-interview": {
      title: "Job interview",
      description: "Practice answering questions as if you are interviewing for a job.",
      tag: "Professional",
    },
    cafe: {
      title: "Ordering at a café",
      description: "Order a drink and something to eat, then handle a small change.",
      tag: "Daily Life",
    },
    neighbor: {
      title: "Meeting a neighbor",
      description: "Introduce yourself and make small talk with someone new.",
      tag: "Social",
    },
  },
  practice: {
    activeScenario: "Active Scenario",
    switchScenario: "Switch scenario",
    finish: "Finish and get feedback",
    finishing: "Finishing…",
    statusListening: "Listening…",
    statusThinking: "Processing…",
    statusSpeaking: "Speaking…",
    statusHandsFree: "Hands-free active",
    statusReady: "Ready for input",
    handsFree: "Hands-free",
    holdToTalk: "Hold to talk",
    releaseToSend: "Release to send",
    stop: "Stop",
    typeMessage: "Type a message",
    placeholder: "Or type what you would say...",
    send: "Send",
    speechUnavailable:
      "Speech recognition is unavailable in this browser. You can type your lines, and replies will be vocalized.",
    speechUnavailableWithoutVoice:
      "Speech recognition is unavailable in this browser. You can type your lines, and replies will be vocalized if audio synthesis is available.",
  },
  transcript: {
    ready: "Ready to listen",
    emptyTitle: "Start the conversation",
    emptyBody:
      "Hold the talk button to speak naturally, or type a sentence below to begin your dialogue.",
    you: "You",
    partner: "Partner",
    listening: "Listening...",
  },
  errors: {
    cannotHear: "This browser cannot hear you. Type your line instead.",
    partnerFailed: "The conversation partner could not reply.",
    emptyReply: "The partner did not say anything. Try again.",
    cutoff: "The reply was cut off. You can keep going.",
    speakFailed: "The reply could not be spoken. You can still read it.",
  },
  speech: {
    "not-allowed": "Microphone access is blocked. Allow the mic, or type instead.",
    "service-not-allowed": "Speech recognition is unavailable in this browser.",
    network: "Speech recognition needs a network connection in this browser.",
    "audio-capture": "No microphone was found.",
    failed: "Speech recognition failed.",
    "already-running": "Speech recognition is already running.",
  },
  placement: {
    title: "Find your level",
    intro:
      "Say hello in English to start. Your partner will ask up to 6 short questions. There are no grades, so just answer as well as you can.",
    progress: "Answers",
    finish: "See my level",
    finishing: "Calculating…",
    resultTitle: "Your starting level",
    speaking: "Speaking",
    writing: "Writing",
    resultNote: "This is a first estimate. It updates as you practice.",
    startPracticing: "Start practicing",
    error: "Your level could not be calculated. Try again.",
    retry: "Try again",
  },
  recap: {
    title: "Your feedback",
    pending: "Preparing your feedback… This takes about half a minute.",
    failed: "Feedback could not be prepared for this conversation.",
    none: "No corrections this time. Nice work!",
    youSaid: "You said",
    correct: "Correct form",
    upgrade: "More natural",
    upgradeOptional: "Optional: your version was correct",
    upgradeAlso: "Optional",
    why: "Why",
    vocabulary: "Words to remember",
    save: "Save to flashcards",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Couldn't save. Try again.",
  },
};

export type Messages = typeof en;

const bn: Messages = {
  home: {
    badge: "স্পোকেন ইংলিশ ট্রেনিং",
    title: "কথা বলা সহজ না হওয়া পর্যন্ত বলতে থাকুন।",
    description:
      "ফ্লুয়েন্সি আপনাকে দিচ্ছে তাৎক্ষণিক ভয়েস পার্টনার। বাস্তব জীবনের পরিস্থিতি বেছে নিন, মুখে কথা বলুন এবং অনায়াসে সরাসরি কথোপকথন চালিয়ে যান।",
    startPracticing: "অনুশীলন শুরু করুন",
    browseScenarios: "পরিস্থিতিগুলো দেখুন",
    steps: [
      {
        number: "০১",
        title: "আপনি কথা বলুন",
        body: "মাইক চেপে ধরে একটি বাক্য বলুন। ব্রাউজারের স্পিচ রেকগনিশন সঙ্গে সঙ্গে আপনার কথা টেক্সট হিসেবে লিখে নেবে।",
      },
      {
        number: "০২",
        title: "পার্টনার উত্তর দেবে",
        body: "আপনার পরিস্থিতির সাথে মানানসই স্বাভাবিক কথ্য ইংরেজিতে পার্টনার উত্তর দেবে, যাতে কথার ছন্দ বজায় থাকে।",
      },
      {
        number: "০৩",
        title: "আপনি শুনুন",
        body: "স্পিচ সিন্থেসিসের মাধ্যমে উত্তরটি মুখে পড়ে শোনানো হবে, যাতে আপনি আবার কথা চালিয়ে যেতে পারেন।",
      },
    ],
    panelBadge: "মূল উদ্দেশ্য",
    panelTitle: "মুখে কথা বলার অভ্যাস গড়ে তোলার জন্য তৈরি",
    panelBody:
      "বাস্তব জীবনের কথোপকথনে তাৎক্ষণিক কথা মনে করতে হয়। তাই নিষ্ক্রিয় অনুশীলনের বদলে ফ্লুয়েন্সি আপনাকে সহজে মুখে কথা বলে আত্মবিশ্বাস বাড়াতে সাহায্য করে।",
    panelCta: "সেশন শুরু করুন",
  },
  picker: {
    badge: "অনুশীলনের পরিস্থিতি বেছে নিন",
    title: "আপনি কী অনুশীলন করতে চান?",
    subtitle:
      "একটি পরিবেশ বেছে নিন। আপনি মুখে কথা বলবেন, সাথে সাথে উত্তর শুনবেন এবং এভাবে কথোপকথন এগিয়ে নেবেন।",
    defaultTag: "পরিস্থিতি",
    begin: "কথোপকথন শুরু করুন",
  },
  scenarios: {
    "free-chat": {
      title: "উন্মুক্ত আলাপ",
      description: "আপনার দিনকাল, ভবিষ্যৎ পরিকল্পনা বা মনের যে কোনো বিষয় নিয়ে কথা বলুন।",
      tag: "স্বতঃস্ফূর্ত",
    },
    "job-interview": {
      title: "চাকরির ইন্টারভিউ",
      description: "চাকরির ইন্টারভিউয়ের জন্য বিভিন্ন প্রশ্নের উত্তর দেওয়ার অনুশীলন করুন।",
      tag: "পেশাদার",
    },
    cafe: {
      title: "ক্যাফেতে অর্ডার করা",
      description: "পানীয় ও খাবার অর্ডার করুন এবং প্রয়োজনে অর্ডার পরিবর্তন করার অনুশীলন করুন।",
      tag: "দৈনন্দিন জীবন",
    },
    neighbor: {
      title: "প্রতিবেশীর সাথে দেখা",
      description: "নিজের পরিচয় দিন এবং নতুন কারো সাথে পরিচিত হওয়ার আলাপ করুন।",
      tag: "সামাজিক",
    },
  },
  practice: {
    activeScenario: "বর্তমান পরিস্থিতি",
    switchScenario: "পরিস্থিতি পরিবর্তন করুন",
    finish: "শেষ করে ফিডব্যাক দেখুন",
    finishing: "শেষ হচ্ছে…",
    statusListening: "শুনছি…",
    statusThinking: "প্রসেসিং হচ্ছে…",
    statusSpeaking: "বলছে…",
    statusHandsFree: "হ্যান্ডস-ফ্রি চালু আছে",
    statusReady: "বলার জন্য প্রস্তুত",
    handsFree: "হ্যান্ডস-ফ্রি",
    holdToTalk: "চেপে ধরে কথা বলুন",
    releaseToSend: "ছেড়ে দিলে পাঠানো হবে",
    stop: "থামুন",
    typeMessage: "মেসেজ লিখুন",
    placeholder: "অথবা যা বলতে চান তা এখানে লিখুন...",
    send: "পাঠান",
    speechUnavailable:
      "এই ব্রাউজারে স্পিচ রেকগনিশন কাজ করছে না। আপনি লিখে পাঠাতে পারেন এবং উত্তর মুখে শোনানো হবে।",
    speechUnavailableWithoutVoice:
      "এই ব্রাউজারে স্পিচ রেকগনিশন কাজ করছে না। আপনি লিখে পাঠাতে পারেন, এবং অডিও সিন্থেসিস থাকলে উত্তর মুখে শোনানো হবে।",
  },
  transcript: {
    ready: "শোনার জন্য প্রস্তুত",
    emptyTitle: "কথোপকথন শুরু করুন",
    emptyBody:
      "কথা বলার বোতামটি চেপে ধরে স্বাভাবিকভাবে কথা বলুন, অথবা নিচে লিখে কথোপকথন শুরু করুন।",
    you: "আপনি",
    partner: "পার্টনার",
    listening: "শুনছি...",
  },
  errors: {
    cannotHear: "এই ব্রাউজার আপনার কথা শুনতে পারছে না। অনুগ্রহ করে লিখে পাঠান।",
    partnerFailed: "পার্টনার উত্তর দিতে পারেনি।",
    emptyReply: "পার্টনার কিছু বলেনি। আবার চেষ্টা করুন।",
    cutoff: "উত্তরটি পুরো আসেনি। আপনি কথা চালিয়ে যেতে পারেন।",
    speakFailed: "উত্তরটি মুখে পড়ে শোনানো যায়নি। তবে আপনি এটি পড়তে পারেন।",
  },
  speech: {
    "not-allowed": "মাইক্রোফোন ব্যবহারের অনুমতি নেই। মাইকের অনুমতি দিন, অথবা লিখে পাঠান।",
    "service-not-allowed": "এই ব্রাউজারে স্পিচ রেকগনিশন সুবিধা নেই।",
    network: "এই ব্রাউজারে স্পিচ রেকগনিশনের জন্য ইন্টারনেট সংযোগ প্রয়োজন।",
    "audio-capture": "কোনো মাইক্রোফোন পাওয়া যায়নি।",
    failed: "স্পিচ রেকগনিশন ব্যর্থ হয়েছে।",
    "already-running": "স্পিচ রেকগনিশন ইতিমধ্যে চালু আছে।",
  },
  placement: {
    title: "আপনার লেভেল জেনে নিন",
    intro:
      "শুরু করতে ইংরেজিতে হ্যালো বলুন। আপনার পার্টনার আপনাকে সর্বোচ্চ ৬টি ছোট প্রশ্ন করবেন। এখানে কোনো গ্রেড নেই, তাই যথাসম্ভব ভালোভাবে উত্তর দিন।",
    progress: "উত্তর",
    finish: "আমার লেভেল দেখুন",
    finishing: "হিসাব করা হচ্ছে…",
    resultTitle: "আপনার শুরুর লেভেল",
    speaking: "বলা",
    writing: "লেখা",
    resultNote: "এটি একটি প্রাথমিক অনুমান। অনুশীলনের সাথে সাথে এটি আপডেট হবে।",
    startPracticing: "অনুশীলন শুরু করুন",
    error: "আপনার লেভেল হিসাব করা যায়নি। আবার চেষ্টা করুন।",
    retry: "আবার চেষ্টা করুন",
  },
  recap: {
    title: "আপনার ফিডব্যাক",
    pending: "আপনার ফিডব্যাক তৈরি হচ্ছে… প্রায় আধা মিনিট লাগবে।",
    failed: "এই কথোপকথনের ফিডব্যাক তৈরি করা যায়নি।",
    none: "এবার কোনো সংশোধন নেই। দারুণ!",
    youSaid: "আপনি বলেছেন",
    correct: "সঠিক রূপ",
    upgrade: "আরও স্বাভাবিক",
    upgradeOptional: "ঐচ্ছিক: আপনার বাক্যটি সঠিক ছিল",
    upgradeAlso: "ঐচ্ছিক",
    why: "কেন",
    vocabulary: "মনে রাখার মতো শব্দ",
    save: "ফ্ল্যাশকার্ডে রাখুন",
    saving: "রাখা হচ্ছে…",
    saved: "রাখা হয়েছে",
    saveFailed: "রাখা যায়নি। আবার চেষ্টা করুন।",
  },
};

const BY_NATIVE_LANGUAGE: Partial<Record<string, Messages>> = { "bn-BD": bn };

export function getMessages(nativeLanguage: string | null | undefined): Messages {
  return (nativeLanguage && BY_NATIVE_LANGUAGE[nativeLanguage]) || en;
}

export { en, bn };
