const app = new Vue({
  el: "#app",
  data: {
    socket: null,
    mic: {
      mediaRecorder: null,
      stream: null,
    },
    settings: {
      mode: "transcribe",
      translation: false,
      transcription: false,
    },
    phrases: {
      final: [],
      pending: [],
    },
    lastWordTime: Date.now(),
    lockedSpeakers: {},
	customLabels: {},
	selectedSpeaker: "",
	newLabel: "",// speaker locking
    currentSpeaker: null,        // for segment buffering
    currentSegmentWords: [],     // words in current speaker's segment
    speakerColors: {
      "Speaker 1": "#F44336",
      "Speaker 2": "#2196F3",
      "Speaker 3": "#4CAF50",
      "Speaker 4": "#9C27B0",
      "Speaker 5": "#FF9800",
      "Speaker 6": "#FFC107",
      "Speaker 7": "#8BC34A",
      "Speaker 8": "#3F51B5",
      "Speaker 9": "#FF5722",
      "Speaker 10": "#00BCD4",
      "Speaker 11": "#00BCD4",
      "Speaker 12": "#00BCD4",
      "Speaker 13": "#00BCD4",
      "Speaker 14": "#00BCD4",
      "Speaker 15": "#00BCD4",
      "Speaker 16": "#00BCD4",
      "Speaker 17": "#00BCD4",
      "Speaker 18": "#00BCD4",
    },
  },
  async created() {
    console.log("Vue app is initializing...");
    this.setModeBasedOnUrlParam();
    await this.getUserMic();
  },
  methods: {
    setModeBasedOnUrlParam() {
      const url = new URL(location.href);
      const search = new URLSearchParams(url.search);
      if (!search.has("mode")) {
        search.set("mode", "badge");
        window.history.replaceState(null, "", "?" + search.toString());
      }
      this.settings.mode = search.get("mode");
      console.log("App mode set to:", this.settings.mode);
    },
    navigateTo(mode) {
      const url = new URL(location.href);
      const search = new URLSearchParams(url.search);
      search.set("mode", mode);
      window.history.replaceState(null, "", "?" + search.toString());
      this.settings.mode = mode;
    },
    async getUserMic() {
      try {
        const permissions = await navigator.permissions.query({ name: "microphone" });
        if (permissions.state === "denied") {
          alert("Akses mikrofon ditolak secara permanen. Silakan ubah pengaturan browser Anda.");
          this.mic.stream = null;
          return;
        }
        this.mic.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!MediaRecorder.isTypeSupported("audio/webm")) {
          throw new Error("Browser tidak mendukung format audio/webm");
        }
        this.mic.mediaRecorder = new MediaRecorder(this.mic.stream, { mimeType: "audio/webm" });
        console.log("Mikrofon berhasil diakses.");
      } catch (err) {
        console.error("Error accessing microphone:", err);
        alert(`Gagal mengakses mikrofon: ${err.message}`);
      }
    },
    async beginTranscription(type = "single") {
      try {
        if (!this.mic.mediaRecorder) {
          alert("Mikrofon belum diakses, silakan refresh dan izinkan akses mikrofon.");
          return;
        }
        this.settings.transcription = type;
        const { key } = await fetch("/deepgram-token").then((r) => r.json());
        const wsUrl =
          "wss://api.deepgram.com/v1/listen?" +
          "model=nova-2&punctuate=true&diarize=true" +
          "&diarize_speaker_count=18&smart_format=true&language=id";
        this.socket = new WebSocket(wsUrl, ["token", key]);
        this.socket.onopen = () => {
          console.log("WebSocket connected.");
          this.mic.mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data.size > 0 && this.socket.readyState === WebSocket.OPEN) {
              this.socket.send(event.data);
            }
          });
          this.mic.mediaRecorder.start(1000);
        };
        this.socket.onmessage = (message) => this.transcriptionResults(JSON.parse(message.data));
        this.socket.onerror = (error) => {
          console.error("WebSocket error:", error);
          alert("Terjadi kesalahan pada koneksi WebSocket.");
        };
        this.socket.onclose = () => {
          console.log("WebSocket connection closed.");
          this.settings.transcription = false;
        };
      } catch (error) {
        console.error("Error starting transcription:", error);
        alert("Gagal memulai transkripsi.");
      }
    },
 async transcriptionResults(data) {
      if (!data?.channel?.alternatives?.length) return;
      const { is_final, channel } = data;
      const words = channel.alternatives[0].words || [];
      if (!words.length) return;

      // detect and lock speaker
      const rawId = words[0].speaker ?? 0;
      if (!(rawId in this.lockedSpeakers)) {
        const used = Object.values(this.lockedSpeakers);
        let n = 1; while (used.includes(`Speaker ${n}`)) n++;
        this.lockedSpeakers[rawId] = `Speaker ${n}`;
      }
      const speaker = this.lockedSpeakers[rawId];

  // assign buffer kata terbaru
  this.currentSegmentWords = words.map(w => w.punctuated_word || w.word);

  // ❗ Hanya satu flush: speaker change _atau_ is_final
  if (this.currentSpeaker && speaker !== this.currentSpeaker) {
    // speaker berganti → flush dulu
    await this.flushSegment();
  } else if (is_final) {
    // segmen final → flush sekali
    await this.flushSegment();
    this.lastWordTime = Date.now();
  }

  // update currentSpeaker setelah flush
  this.currentSpeaker = speaker;
},



    async flushSegment() {
      if (!this.currentSegmentWords.length || !this.currentSpeaker) return;
      const rawText = this.currentSegmentWords.join(' ').trim();
      let formatted = rawText;
      try {
        const resp = await fetch('/punctuate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: rawText })
        });
        const json = await resp.json();
        if (json.formattedText) formatted = json.formattedText;
      } catch (e) {
        console.error('Punctuation error', e);
      }
      this.phrases.final.push({ speaker: this.currentSpeaker, word: formatted.trim() });
      this.currentSegmentWords = [];
    },
    async fixPunctuation() {},
    stopTranscription() {
      if (this.mic.mediaRecorder && this.mic.mediaRecorder.state !== "inactive")
        this.mic.mediaRecorder.stop();
      if (this.socket && this.socket.readyState === WebSocket.OPEN)
        this.socket.close();
      this.settings.transcription = false;
    },
    clearTranscript() {
      this.phrases.final = [];
      this.phrases.pending = [];
      this.lockedSpeakers = {};
      this.currentSpeaker = null;
      this.currentSegmentWords = [];
    },
    downloadRTF() {
      const text = this.singleTranscript;
      if (!text) return alert("Tidak ada transkripsi untuk diunduh!");
      const rtfBody = text.split("\n").map(l => l.trim() ? `\\par ${l}` : "\\par ").join("");
      const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\viewkind4\\uc1\\pard\\f0\\fs24 ${rtfBody} \\par}`;
      const blob = new Blob([rtf], { type: "application/rtf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "transkrip.rtf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
	displayLabel(speaker) {
		return this.customLabels[speaker] || speaker;
	},
	applyRename() {
		if (this.selectedSpeaker && this.newLabel.trim()) {
			this.$set(this.customLabels, this.selectedSpeaker, this.newlabel.trim());
			this.newLabel = "";
		}
	}
  },
  computed: {
    singleTranscript() {
      let transcript = "";
      let lastSp = null;
      let sentence = "";
      this.groupTranscript.forEach((w, i) => {
		const label = this.displayLabel(w.speaker);
        if (lastSp && w.speaker !== lastSp) {
          transcript += `\n\n${label}: ${sentence.trim()}\n\n`;
          sentence = "";
        }
        sentence += w.word + "";
        lastSp = w.speaker;
        if (i === this.groupTranscript.length - 1) {
          transcript += `${label}: ${sentence.trim()}`;
        }
      });
      return transcript.trim();
    },
    groupTranscript() {
      return [...this.phrases.final];
    }
  },
  
  watch: {
	  singleTranscript() {
		  this.$nextTick(() => {
			  const container = this.$el.querySelector('#transcribe p');
			  if (container) container.scrollTop = container.scrollHeight;
		  });
	  }
  }
});