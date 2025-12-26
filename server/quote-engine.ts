import OpenAI from "openai";
import { promptTemplateManager } from "./prompt-templates";
import { quoteEngineLearning } from "./machine-learning";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration for weighted quote type determination
export interface QuoteEngineConfig {
  weights: {
    customerType: number;
    jobScope: number;
    urgency: number;
    complexity: number;
    visualAid: number;
  };
  thresholds: {
    instantQuote: number;
    videoQuote: number;
    siteVisit: number;
  };
  // Customer type values (0-1 scale)
  customerTypeValues: {
    residential: number;
    commercial: number;
    propertyManager: number;
  };
  // Job scope values (0-1 scale)
  jobScopeValues: {
    single: number;
    multiple: number;
  };
  // Urgency values (0-1 scale)
  urgencyValues: {
    normal: number;
    urgent: number;
    emergency: number;
  };
}

// Default configuration as per implementation guide
export const defaultQuoteEngineConfig: QuoteEngineConfig = {
  weights: {
    customerType: 0.1,
    jobScope: 0.1,
    urgency: 0.1,
    complexity: 0.4,
    visualAid: 0.3
  },
  thresholds: {
    instantQuote: 0.2,
    videoQuote: 0.67,
    siteVisit: 1.0
  },
  customerTypeValues: {
    residential: 0.0,
    commercial: 0.5,
    propertyManager: 1.0
  },
  jobScopeValues: {
    single: 0.0,
    multiple: 1.0
  },
  urgencyValues: {
    normal: 0.0,
    urgent: 0.5,
    emergency: 1.0
  }
};

export interface GPTComplexityResult {
  complexity: number; // 0.0 to 1.0
  needs_visual: boolean;
  reasoning: string;
}

export interface QuoteTypeInput {
  customerType: 'residential' | 'commercial' | 'propertyManager';
  jobScope: 'single' | 'multiple';
  urgency: 'normal' | 'urgent' | 'emergency';
  jobDescription: string;
}

export interface QuoteTypeResult {
  recommendedType: 'instant_quote' | 'video_quote' | 'site_visit';
  combinedScore: number;
  gptResult: GPTComplexityResult;
  factors: {
    customerTypeScore: number;
    jobScopeScore: number;
    urgencyScore: number;
    complexityScore: number;
    visualAidScore: number;
  };
  reasoning: string;
}

export class QuoteEngine {
  private config: QuoteEngineConfig;

  constructor(config: QuoteEngineConfig = defaultQuoteEngineConfig) {
    this.config = config;
  }

  // Get GPT complexity analysis with structured output using templates
  async getComplexityAnalysis(jobDescription: string): Promise<GPTComplexityResult> {
    try {
      const prompt = promptTemplateManager.processTemplate('complexity_analysis', {
        JOB_DESCRIPTION: jobDescription
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert handyman service specialist. Respond only with valid JSON as specified."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1 // Low temperature for consistency
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        complexity: Math.max(0, Math.min(1, result.complexity || 0.5)),
        needs_visual: Boolean(result.needs_visual),
        reasoning: result.reasoning || "Analysis completed"
      };
    } catch (error) {
      console.error('Error in GPT complexity analysis:', error);
      // Fallback to conservative defaults
      return {
        complexity: 0.7,
        needs_visual: true,
        reasoning: "Unable to analyze - defaulting to conservative assessment"
      };
    }
  }

  // Calculate weighted score and determine quote type
  async determineQuoteType(input: QuoteTypeInput): Promise<QuoteTypeResult> {
    // Get GPT complexity analysis
    const gptResult = await this.getComplexityAnalysis(input.jobDescription);

    // Map categorical inputs to numeric values
    const customerTypeScore = this.config.customerTypeValues[input.customerType] || 0;
    const jobScopeScore = this.config.jobScopeValues[input.jobScope] || 0;
    const urgencyScore = this.config.urgencyValues[input.urgency] || 0;
    const complexityScore = gptResult.complexity;
    const visualAidScore = gptResult.needs_visual ? 1.0 : 0.0;

    // Calculate weighted combined score
    const combinedScore = 
      this.config.weights.customerType * customerTypeScore +
      this.config.weights.jobScope * jobScopeScore +
      this.config.weights.urgency * urgencyScore +
      this.config.weights.complexity * complexityScore +
      this.config.weights.visualAid * visualAidScore;

    // Apply business rules and thresholds
    let recommendedType: 'instant_quote' | 'video_quote' | 'site_visit';
    
    // Override rules as per implementation guide
    if (gptResult.needs_visual && combinedScore >= this.config.thresholds.instantQuote) {
      // If visual aid needed, minimum video quote
      recommendedType = combinedScore >= this.config.thresholds.videoQuote ? 'site_visit' : 'video_quote';
    } else if (input.customerType === 'commercial' && input.jobScope === 'multiple') {
      // Commercial multi-job always needs at least video assessment
      recommendedType = combinedScore >= this.config.thresholds.videoQuote ? 'site_visit' : 'video_quote';
    } else {
      // Standard threshold logic
      if (combinedScore < this.config.thresholds.instantQuote) {
        recommendedType = 'instant_quote';
      } else if (combinedScore < this.config.thresholds.videoQuote) {
        recommendedType = 'video_quote';
      } else {
        recommendedType = 'site_visit';
      }
    }

    const reasoning = this.generateReasoning(
      recommendedType,
      combinedScore,
      gptResult,
      input
    );

    return {
      recommendedType,
      combinedScore,
      gptResult,
      factors: {
        customerTypeScore,
        jobScopeScore,
        urgencyScore,
        complexityScore,
        visualAidScore
      },
      reasoning
    };
  }

  private generateReasoning(
    type: string,
    score: number,
    gpt: GPTComplexityResult,
    input: QuoteTypeInput
  ): string {
    let reasoning = `Recommended ${type.replace('_', ' ')} (score: ${score.toFixed(2)}). `;
    
    reasoning += `GPT complexity: ${gpt.complexity.toFixed(2)}, `;
    reasoning += `Visual aid ${gpt.needs_visual ? 'required' : 'not required'}. `;
    
    if (input.customerType !== 'residential') {
      reasoning += `${input.customerType} customer requires enhanced service. `;
    }
    
    if (input.jobScope === 'multiple') {
      reasoning += `Multiple jobs increase coordination complexity. `;
    }
    
    if (input.urgency !== 'normal') {
      reasoning += `${input.urgency} priority affects assessment needs. `;
    }
    
    reasoning += gpt.reasoning;
    
    return reasoning;
  }

  // Update configuration
  updateConfig(newConfig: Partial<QuoteEngineConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // Get current configuration
  getConfig(): QuoteEngineConfig {
    return { ...this.config };
  }
}

export const quoteEngine = new QuoteEngine();