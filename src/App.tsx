import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, ImagePlus, Sparkles, Key, Compass, Home, BookOpen } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI } from '@google/genai';
import { cn } from './lib/utils';

// --- Types ---
type AppState = 'landing' | 'upload' | 'analyzing' | 'results';

interface AnalysisResult {
  fengShui: string;
  environmental: string;
  suggestions: string;
  imagePrompts?: string[];
  generatedImages: string[];
}

// --- Components ---

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  const [apiKey, setApiKey] = useState(process.env.GEMINI_API_KEY || '');
  const [activationCode, setActivationCode] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    if (!apiKey && !activationCode) {
      setShowSettings(true);
    } else {
      setAppState('upload');
    }
  };

  const handleImageUpload = (file: File) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async () => {
    if (!imageFile || !imagePreview) return;
    
    setAppState('analyzing');
    setError(null);

    try {
      const keyToUse = apiKey || process.env.GEMINI_API_KEY;
      if (!keyToUse) {
        throw new Error("请赐予灵钥（API Key或激活码）");
      }

      const ai = new GoogleGenAI({ apiKey: keyToUse });
      const base64Data = imagePreview.split(',')[1];
      
      const prompt = `
      作为一位精通传统风水学、环境行为学和人居科学的室内设计大师。
      请分析这张户型图，并提供以下格式的JSON输出（不要包含markdown代码块标记，直接输出纯JSON）：
      {
        "fengShui": "从传统风水学角度的分析（如气口、动静分区、五行方位等），语言要带有古典韵味。",
        "environmental": "从环境行为学和人居科学角度的分析（如动线、采光、空间心理学等）。",
        "suggestions": "具体的室内设计建议（如具体的材质、色彩色号、家具摆放位置等）。必须以具体的要点（1. 2. 3.）形式列出，要求非常具体、可落地，绝不能空泛。",
        "imagePrompts": [
          "3个用于生成设计效果图的英文Prompt。必须严格基于上传户型图中的实际空间结构（如户型图上实际存在的主卧、客厅等）来生成，不要自己编造不存在的空间。描述要详细，包含空间名称、古典/高级美院风格、水墨或工笔画质感、具体的材质和光影等关键词。"
        ]
      }
      `;

      const textResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: imageFile.type
            }
          },
          prompt
        ],
        config: {
          responseMimeType: "application/json",
        }
      });

      const resultText = textResponse.text;
      if (!resultText) {
        throw new Error("天机难测，文本推演失败。");
      }
      const parsedResult = JSON.parse(resultText) as AnalysisResult;

      const promptsToUse = parsedResult.imagePrompts && parsedResult.imagePrompts.length > 0 
        ? parsedResult.imagePrompts 
        : [
            "A high-quality 3D interior design render of a main living room. Traditional Chinese classical style, elegant wooden furniture, ink wash aesthetic, warm lighting, photorealistic.",
            "A high-quality 3D interior design render of a master bedroom. Traditional Chinese classical style, serene and peaceful, silk textures, soft natural light, photorealistic.",
            "A high-quality 3D interior design render of a study or tea room. Traditional Chinese classical style, Zen atmosphere, bamboo elements, artistic shadows, photorealistic."
          ];

      const imagePromises = promptsToUse.slice(0, 3).map(imgPrompt => 
        ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: imageFile.type } },
              { text: "Based strictly on the layout of the provided floor plan image: " + imgPrompt }
            ]
          },
          config: {
            // @ts-ignore
            imageConfig: {
              aspectRatio: "4:3",
            }
          }
        })
      );

      const imageResults = await Promise.allSettled(imagePromises);
      const generatedImages: string[] = [];

      imageResults.forEach((res) => {
        if (res.status === 'fulfilled') {
          const parts = res.value.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData) {
              generatedImages.push(`data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`);
              break;
            }
          }
        } else {
          console.error("Image generation failed:", res.reason);
        }
      });

      setAnalysis({
        ...parsedResult,
        generatedImages
      });
      setAppState('results');

    } catch (err: any) {
      console.error(err);
      setError(err.message || "推演受阻，请检查灵钥或稍后重试。");
      setAppState('upload');
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-paper selection:bg-gold/30">
      {/* Header */}
      <header className="absolute top-0 w-full p-8 flex justify-between items-center z-50">
        <div className="flex items-center gap-3 text-ink opacity-80 hover:opacity-100 transition-opacity cursor-pointer" onClick={() => setAppState('landing')}>
          <span className="font-calligraphy text-2xl tracking-[0.2em]">人居境象</span>
        </div>
        <button 
          onClick={() => setShowSettings(true)}
          className="p-3 rounded-full hover:bg-ink/5 transition-all text-ink/80 hover:text-ink hover:rotate-90 duration-500"
        >
          <Settings className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-6 relative z-10 w-full max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {appState === 'landing' && (
            <LandingView key="landing" onStart={handleStart} />
          )}
          {appState === 'upload' && (
            <UploadView 
              key="upload" 
              imagePreview={imagePreview}
              onUpload={handleImageUpload}
              onAnalyze={analyzeImage}
              error={error}
            />
          )}
          {appState === 'analyzing' && (
            <AnalyzingView key="analyzing" />
          )}
          {appState === 'results' && analysis && imagePreview && (
            <ResultsView 
              key="results" 
              analysis={analysis} 
              imagePreview={imagePreview}
              onReset={() => {
                setAppState('upload');
                setImageFile(null);
                setImagePreview(null);
                setAnalysis(null);
              }}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal 
            apiKey={apiKey}
            setApiKey={setApiKey}
            activationCode={activationCode}
            setActivationCode={setActivationCode}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>
      
      {/* Decorative Elements - Ink Wash effect */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.1, 0.15, 0.1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-jade ink-drop" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.05, 0.1, 0.05]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut", delay: 5 }}
          className="absolute -bottom-[20%] -right-[10%] w-[70vw] h-[70vw] rounded-full bg-gold ink-drop" 
        />
      </div>
    </div>
  );
}

// --- Subcomponents ---

const LandingView: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
      transition={{ duration: 1.5, ease: "easeOut" }}
      className="flex flex-col items-center text-center max-w-3xl relative z-10"
    >
      <div className="writing-vertical font-calligraphy text-7xl md:text-9xl text-ink mb-16 tracking-[0.3em] h-80 border-l border-ink/20 pl-12">
        寻境问室
      </div>
      <p className="text-lg md:text-xl text-charcoal/70 mb-16 leading-loose font-light tracking-[0.2em]">
        融合环境行为学、传统风水与人居科学<br/>
        以AI之眼，洞见空间之气韵，重塑理想居所
      </p>
      <button 
        onClick={onStart}
        className="group relative px-16 py-5 overflow-hidden rounded-sm border border-ink/20 bg-transparent text-ink transition-all duration-700 hover:border-ink hover:bg-ink hover:text-paper"
      >
        <span className="relative z-10 flex items-center gap-4 tracking-[0.3em] text-lg">
          <Compass className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" />
          开启勘境
        </span>
      </button>
    </motion.div>
  );
};

const UploadView: React.FC<{ 
  imagePreview: string | null, 
  onUpload: (file: File) => void,
  onAnalyze: () => void,
  error: string | null
}> = ({ 
  imagePreview, 
  onUpload, 
  onAnalyze,
  error 
}) => {
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png'] },
    maxFiles: 1
  } as any);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.8 }}
      className="w-full max-w-3xl flex flex-col items-center"
    >
      <h2 className="text-4xl font-calligraphy mb-12 tracking-[0.2em] text-ink">呈上图卷</h2>
      
      <div 
        {...getRootProps()} 
        className={cn(
          "w-full aspect-[4/3] md:aspect-[21/9] border border-ink/20 flex flex-col items-center justify-center cursor-pointer transition-all duration-700 overflow-hidden relative group bg-white/30 backdrop-blur-sm",
          isDragActive ? "border-jade bg-jade/5" : "hover:border-gold/50 hover:bg-gold/5",
          imagePreview ? "border-none shadow-2xl shadow-ink/5" : ""
        )}
      >
        <input {...getInputProps()} />
        
        {imagePreview ? (
          <>
            <img src={imagePreview} alt="Floor plan" className="w-full h-full object-contain p-2 opacity-90 mix-blend-multiply" />
            <div className="absolute inset-0 bg-paper/80 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center backdrop-blur-md">
              <p className="text-ink tracking-[0.2em] flex items-center gap-3 text-lg">
                <ImagePlus className="w-5 h-5" /> 更换图卷
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-charcoal/50 space-y-6">
            <div className="w-20 h-20 rounded-full border border-current flex items-center justify-center mb-2 group-hover:scale-110 transition-transform duration-700">
              <ImagePlus className="w-8 h-8" strokeWidth={1} />
            </div>
            <p className="tracking-[0.2em] text-xl">点击或拖拽上传户型图</p>
            <p className="text-sm opacity-60 tracking-widest">支持 JPG, PNG 格式</p>
          </div>
        )}
      </div>

      {error && (
        <motion.p 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="mt-8 text-cinnabar tracking-widest"
        >
          {error}
        </motion.p>
      )}

      <AnimatePresence>
        {imagePreview && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
            className="mt-16 px-20 py-5 bg-ink text-paper tracking-[0.3em] hover:bg-charcoal transition-colors duration-500 flex items-center gap-4 text-lg shadow-2xl shadow-ink/20 relative overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <Compass className="w-5 h-5" strokeWidth={1.5} />
            开始推演
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const AnalyzingView: React.FC = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center justify-center space-y-16"
    >
      <div className="relative w-40 h-40">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 border border-ink/20 rounded-full"
        />
        <motion.div 
          animate={{ rotate: -360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute inset-4 border border-dashed border-gold/40 rounded-full"
        />
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          className="absolute inset-8 border border-jade/30 rounded-full"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Compass className="w-12 h-12 text-ink/80 animate-pulse" strokeWidth={1} />
        </div>
      </div>
      <div className="flex flex-col items-center space-y-6">
        <p className="font-calligraphy text-4xl tracking-[0.4em] text-ink">推演中</p>
        <p className="text-charcoal/50 tracking-[0.2em] text-sm">检索云端典籍 · 测算空间气场 · 绘制意境图卷</p>
      </div>
    </motion.div>
  );
};

const ResultsView: React.FC<{ analysis: AnalysisResult, imagePreview: string, onReset: () => void }> = ({ analysis, imagePreview, onReset }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full h-[90vh] flex flex-col lg:flex-row gap-12 overflow-hidden"
    >
      {/* Left Column: Image & Controls */}
      <div className="w-full lg:w-1/3 flex flex-col gap-8 h-full">
        <div className="bg-white/40 p-6 border border-ink/10 shadow-xl shadow-ink/5 relative group">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-ink/30" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-ink/30" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-ink/30" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-ink/30" />
          <img src={imagePreview} alt="Original Floor Plan" className="w-full h-auto object-contain mix-blend-multiply opacity-80" />
        </div>
        <button 
          onClick={onReset}
          className="py-4 border border-ink/20 text-ink tracking-[0.2em] hover:bg-ink hover:text-paper transition-all duration-500"
        >
          重新勘境
        </button>
      </div>

      {/* Right Column: Scrollable Analysis (Paper Scroll Effect) */}
      <div className="w-full lg:w-2/3 h-full overflow-y-auto pr-8 pb-32 space-y-16 custom-scrollbar paper-scroll p-8">
        
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="flex items-center gap-4 mb-8 border-b border-ink/10 pb-6">
            <Compass className="w-8 h-8 text-jade opacity-80" strokeWidth={1.5} />
            <h3 className="text-3xl font-calligraphy tracking-[0.2em]">风水堪舆</h3>
          </div>
          <p className="text-lg leading-[2.5] text-charcoal/90 tracking-wide text-justify font-light whitespace-pre-wrap">
            {analysis.fengShui}
          </p>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <div className="flex items-center gap-4 mb-8 border-b border-ink/10 pb-6">
            <Home className="w-8 h-8 text-gold opacity-80" strokeWidth={1.5} />
            <h3 className="text-3xl font-calligraphy tracking-[0.2em]">人居境理</h3>
          </div>
          <p className="text-lg leading-[2.5] text-charcoal/90 tracking-wide text-justify font-light whitespace-pre-wrap">
            {analysis.environmental}
          </p>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <div className="flex items-center gap-4 mb-8 border-b border-ink/10 pb-6">
            <BookOpen className="w-8 h-8 text-cinnabar opacity-80" strokeWidth={1.5} />
            <h3 className="text-3xl font-calligraphy tracking-[0.2em]">造境方略</h3>
          </div>
          <p className="text-lg leading-[2.5] text-charcoal/90 tracking-wide text-justify font-light whitespace-pre-wrap">
            {analysis.suggestions}
          </p>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <div className="flex items-center gap-4 mb-8 border-b border-ink/10 pb-6">
            <Sparkles className="w-8 h-8 text-ink opacity-80" strokeWidth={1.5} />
            <h3 className="text-3xl font-calligraphy tracking-[0.2em]">意境参考</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {analysis.generatedImages && analysis.generatedImages.length > 0 ? analysis.generatedImages.map((imgSrc, idx) => (
              <div key={idx} className="group relative aspect-[4/3] bg-ink/5 overflow-hidden border border-ink/10 flex flex-col">
                <img src={imgSrc} alt={`意境图 ${idx + 1}`} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent opacity-80" />
                <div className="relative z-10 p-6 mt-auto">
                  <div className="flex items-center gap-2 mt-4">
                    <div className="h-[1px] w-8 bg-gold/50" />
                    <p className="text-gold text-xs tracking-[0.2em]">图卷 {idx + 1}</p>
                  </div>
                </div>
              </div>
            )) : (
              <p className="text-charcoal/50 text-sm tracking-widest col-span-2">未能成功生成意境图，请稍后重试。</p>
            )}
          </div>
        </motion.section>

      </div>
    </motion.div>
  );
};

const SettingsModal: React.FC<{ 
  apiKey: string, setApiKey: (v: string) => void,
  activationCode: string, setActivationCode: (v: string) => void,
  onClose: () => void
}> = ({ 
  apiKey, setApiKey, 
  activationCode, setActivationCode, 
  onClose 
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/60 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 20, opacity: 0 }}
        transition={{ duration: 0.4 }}
        onClick={e => e.stopPropagation()}
        className="bg-paper w-full max-w-md p-10 shadow-2xl border border-ink/20 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-jade via-gold to-cinnabar opacity-80" />
        
        <h3 className="text-3xl font-calligraphy mb-8 tracking-[0.2em] flex items-center gap-3 text-ink">
          <Key className="w-6 h-6 opacity-80" strokeWidth={1.5} /> 秘钥设置
        </h3>

        <div className="space-y-8">
          <div>
            <label className="block text-sm tracking-[0.2em] text-charcoal/70 mb-3">Gemini API Key</label>
            <input 
              type="password" 
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="输入您的 API Key"
              className="w-full bg-transparent border-b border-ink/20 py-3 focus:outline-none focus:border-gold transition-colors font-sans text-ink placeholder:text-ink/20"
            />
            <p className="text-xs text-charcoal/40 mt-3 tracking-widest">使用自带的 API Key 进行推演</p>
          </div>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-ink/10"></div>
            <span className="flex-shrink-0 mx-6 text-charcoal/30 text-sm tracking-[0.2em] font-calligraphy">或</span>
            <div className="flex-grow border-t border-ink/10"></div>
          </div>

          <div>
            <label className="block text-sm tracking-[0.2em] text-charcoal/70 mb-3">激活码</label>
            <input 
              type="text" 
              value={activationCode}
              onChange={e => setActivationCode(e.target.value)}
              placeholder="输入购买的激活码"
              className="w-full bg-transparent border-b border-ink/20 py-3 focus:outline-none focus:border-jade transition-colors font-sans text-ink placeholder:text-ink/20"
            />
          </div>

          <button 
            onClick={onClose}
            className="w-full py-4 bg-ink text-paper tracking-[0.3em] mt-8 hover:bg-charcoal transition-colors duration-500"
          >
            确认
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

