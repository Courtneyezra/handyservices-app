// GPT Prompt Templates for Quote Engine
// These templates can be customized by admins to fine-tune AI behavior

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  category: 'complexity' | 'visual_aid' | 'quote_generation' | 'pricing';
  version: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const defaultPromptTemplates: PromptTemplate[] = [
  {
    id: 'complexity_analysis',
    name: 'Job Complexity Analysis',
    description: 'Analyzes job descriptions to determine complexity score and visual aid requirements',
    category: 'complexity',
    version: '1.0',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    template: `You are an expert handyman assistant. Analyze the job description below and provide a complexity assessment.

Consider these factors for complexity scoring (0.0 to 1.0):
- Required skill level (basic maintenance vs specialized trades)
- Potential complications and unforeseen issues  
- Safety risks and liability concerns
- Tools and equipment requirements
- Time and effort involved

Consider these factors for visual aid requirement:
- How clearly the job can be described in text
- Whether dimensions, conditions, or aesthetics matter
- If structural or hidden elements need assessment
- Whether photos/video would significantly improve quote accuracy

Job Description: {{JOB_DESCRIPTION}}

Respond with JSON containing:
- complexity: number between 0.0 and 1.0
- needs_visual: boolean
- reasoning: brief explanation of the assessment`
  },
  {
    id: 'pricing_estimation',
    name: 'Pricing Estimation',
    description: 'Generates accurate time and cost estimates for handyman tasks',
    category: 'pricing',
    version: '1.0',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    template: `You are a UK handyman pricing expert with 20 years experience. For each task, provide accurate time estimates based on UK industry standards.

Tasks:
{{TASK_LIST}}

Customer Details:
{{CUSTOMER_ANSWERS}}

Job Context:
{{JOB_SUMMARY}}

Consider:
- Customer-specific details from answers (dimensions, materials, access, condition)
- Setup and cleanup time
- Skill level required for each service type
- Task complexity levels
- UK handyman industry standards
- Realistic working pace

Respond with JSON:
{
  "taskEstimates": [
    {
      "taskIndex": 0,
      "estimatedHours": 2.5,
      "reasoning": "Brief explanation including customer-specific factors"
    }
  ]
}`
  },
  {
    id: 'quote_recommendation',
    name: 'Quote Method Recommendation',
    description: 'Determines the best quoting approach based on job characteristics',
    category: 'quote_generation',
    version: '1.0',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    template: `You are an expert quote method selector for Handy Services. Use this scoring matrix to determine the best quoting approach:

SCORING CRITERIA (1-5 scale):
Online Quote: Speed(5), Clarity(3), Professional(3), Conversion(4), Risk(2), Cost(5), Accuracy(3), Complexity(1) = Total: 28
Video Quote: Speed(3), Clarity(4), Professional(4), Conversion(5), Risk(4), Cost(4), Accuracy(4), Complexity(4) = Total: 35  
Site Visit: Speed(1), Clarity(5), Professional(5), Conversion(3), Risk(5), Cost(1), Accuracy(5), Complexity(5) = Total: 33

DECISION RULES:
- Online Quote: Simple, standardized jobs with clear requirements, low complexity, under £300
- Video Quote: Medium complexity jobs needing visual assessment, £200-£800 range
- Site Visit: Complex jobs, high-value work, structural/electrical, over £500

Job Analysis:
{{JOB_ANALYSIS}}

Customer Answers:
{{CUSTOMER_ANSWERS}}

Customer Info:
{{CUSTOMER_INFO}}

Evaluate these factors:
1. Job Complexity: Simple tasks vs complex installations
2. Information Completeness: Are dimensions, materials, access clear?
3. Visual Assessment Need: Can job be understood without seeing it?
4. Risk Factors: Potential for scope creep or complications
5. Value Range: Estimated total cost
6. Customer Urgency: From customer details

Choose the highest-scoring method based on job characteristics.

Respond with JSON:
{
  "action": "provide_quote|schedule_video|schedule_visit",
  "reasoning": "Scoring analysis and specific factors leading to this recommendation",
  "nextSteps": ["Step 1", "Step 2", "Step 3"],
  "shouldGenerateQuote": true|false
}`
  }
];

export class PromptTemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();

  constructor() {
    // Initialize with default templates
    defaultPromptTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  getActiveTemplate(category: string): PromptTemplate | undefined {
    return Array.from(this.templates.values())
      .find(t => t.category === category && t.isActive);
  }

  updateTemplate(id: string, updates: Partial<PromptTemplate>): boolean {
    const template = this.templates.get(id);
    if (!template) return false;

    const updatedTemplate = {
      ...template,
      ...updates,
      updatedAt: new Date()
    };

    this.templates.set(id, updatedTemplate);
    return true;
  }

  createTemplate(template: Omit<PromptTemplate, 'createdAt' | 'updatedAt'>): PromptTemplate {
    const newTemplate: PromptTemplate = {
      ...template,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.templates.set(template.id, newTemplate);
    return newTemplate;
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  // Process template with variable substitution
  processTemplate(templateId: string, variables: Record<string, string>): string {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    let processed = template.template;
    
    // Replace variables in {{VARIABLE_NAME}} format
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      processed = processed.replace(new RegExp(placeholder, 'g'), value);
    });

    return processed;
  }
}

export const promptTemplateManager = new PromptTemplateManager();